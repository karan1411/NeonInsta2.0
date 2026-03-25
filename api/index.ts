import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "NeonInsta API is alive" });
});

// API Route to fetch Instagram media
app.post(["/api/fetch-insta", "/fetch-insta"], async (req, res) => {
    let { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({ error: "Invalid Instagram URL" });
    }

    // Normalize URL
    try {
      const urlObj = new URL(url);
      urlObj.search = ""; // Remove query parameters
      url = urlObj.toString();
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const isStory = url.includes("/stories/");

    try {
      // Strategy 1: Standard Mobile Request
      const fetchInstagram = async (userAgent: string) => {
        return await axios.get(url, {
          headers: {
            "User-Agent": userAgent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
            "Referer": "https://www.google.com/",
          },
          maxRedirects: 5,
          timeout: 10000,
          validateStatus: (status) => status < 500,
        });
      };

      const userAgents = [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      ];

      let response;
      let html = "";
      
      // Try different user agents if blocked
      for (const ua of userAgents) {
        try {
          response = await fetchInstagram(ua);
          const finalUrl = response.request.res.responseUrl || url;
          if (!finalUrl.includes("accounts/login")) {
            html = response.data;
            if (html.includes("video_url") || html.includes("video_versions") || html.includes(".mp4")) {
              break;
            }
          }
        } catch (e) {}
      }

      // Strategy 2: GraphQL Fallback (if no video found yet)
      const shortcodeMatch = url.match(/\/(?:p|reels|reel)\/([A-Za-z0-9_-]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

      if (shortcode && (!html || !html.includes(".mp4"))) {
        try {
          const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=b7d3d6544695990391a4f148fdd9c063&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
          const gqlResponse = await axios.get(gqlUrl, {
            headers: {
              "User-Agent": userAgents[0],
              "X-Requested-With": "XMLHttpRequest",
              "Referer": url,
            },
            timeout: 5000,
          });
          
          const media = gqlResponse.data?.data?.shortcode_media;
          if (media) {
            const results: any[] = [];
            const title = media.edge_media_to_caption?.edges?.[0]?.node?.text || "Instagram Media";

            // Check for carousel (multiple items)
            if (media.edge_sidecar_to_children) {
              media.edge_sidecar_to_children.edges.forEach((edge: any) => {
                const node = edge.node;
                results.push({
                  mediaUrl: node.is_video ? node.video_url : node.display_url,
                  thumbnail: node.display_url,
                  type: node.is_video ? "video" : "image",
                });
              });
            } else {
              results.push({
                mediaUrl: media.is_video ? media.video_url : media.display_url,
                thumbnail: media.display_url,
                type: media.is_video ? "video" : "image",
              });
            }
            
            if (results.length > 0) {
              return res.json({
                success: true,
                results,
                title,
                isReel: url.includes("/reel/") || url.includes("/reels/"),
                isStory
              });
            }
          }
        } catch (e) {}
      }

      if (!html) {
        return res.status(403).json({ error: "Instagram is currently blocking our server. This happens because they protect their content aggressively. Please try again in 2-3 minutes." });
      }

      const $ = cheerio.load(html);
      const results: any[] = [];
      let title = $('meta[property="og:title"]').attr("content") || "Instagram Media";

      // 1. OG Tags (Fallback for single item)
      const ogVideo = $('meta[property="og:video"]').attr("content") || $('meta[property="og:video:secure_url"]').attr("content");
      const ogImage = $('meta[property="og:image"]').attr("content");

      // 2. Aggressive JSON Extraction for multiple items
      $("script").each((_, script) => {
        const content = $(script).html();
        if (!content || !content.includes("display_url")) return;

        try {
          // Look for edge_sidecar_to_children in JSON strings
          if (content.includes("edge_sidecar_to_children")) {
            const carouselMatch = content.match(/"edge_sidecar_to_children":\s*\{"edges":\s*\[(.*?)\]\}/);
            if (carouselMatch) {
              const edgesStr = carouselMatch[1];
              const mediaMatches = edgesStr.match(/"node":\s*\{(.*?)\}/g);
              if (mediaMatches) {
                mediaMatches.forEach(m => {
                  const isVideo = m.includes('"is_video":true');
                  const videoMatch = m.match(/"video_url":"([^"]+)"/);
                  const displayMatch = m.match(/"display_url":"([^"]+)"/);
                  
                  if (displayMatch) {
                    const displayUrl = displayMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/") : null;
                    
                    results.push({
                      mediaUrl: isVideo ? videoUrl : displayUrl,
                      thumbnail: displayUrl,
                      type: isVideo ? "video" : "image"
                    });
                  }
                });
              }
            }
          }
          
          // Fallback: search for all video_url and display_url pairs
          if (results.length === 0) {
            const videoMatches = content.match(/"video_url":"([^"]+)"/g);
            const displayMatches = content.match(/"display_url":"([^"]+)"/g);
            
            if (videoMatches) {
              videoMatches.forEach((v, i) => {
                const vUrl = v.match(/"video_url":"([^"]+)"/)?.[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                if (vUrl && !results.some(r => r.mediaUrl === vUrl)) {
                  results.push({
                    mediaUrl: vUrl,
                    thumbnail: vUrl, // Fallback thumbnail
                    type: "video"
                  });
                }
              });
            }
          }
        } catch (e) {}
      });

      // 3. If still empty, use OG tags
      if (results.length === 0) {
        if (ogVideo) {
          results.push({
            mediaUrl: ogVideo,
            thumbnail: ogImage || ogVideo,
            type: "video"
          });
        } else if (ogImage) {
          results.push({
            mediaUrl: ogImage,
            thumbnail: ogImage,
            type: "image"
          });
        }
      }

      // 4. Story specific extraction (often found in xdt_api__v1__media__direct_path or similar)
      if (isStory && results.length === 0) {
        const directPathMatch = html.match(/"xdt_api__v1__media__direct_path":"([^"]+)"/);
        if (directPathMatch) {
          const url = directPathMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
          results.push({
            mediaUrl: url,
            thumbnail: url,
            type: url.includes(".mp4") ? "video" : "image"
          });
        }
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Media not found. The post might be private or the link is invalid." });
      }

      // Deduplicate results
      const uniqueResults = results.filter((v, i, a) => a.findIndex(t => t.mediaUrl === v.mediaUrl) === i);

      res.json({
        success: true,
        results: uniqueResults,
        title,
        isReel: url.includes("/reel/") || url.includes("/reels/"),
        isStory
      });
    } catch (error: any) {
      console.error("Fetch error:", error.message);
      res.status(500).json({ error: "Failed to connect to Instagram. Please try again." });
    }
  });

  // Proxy download endpoint to bypass CORS and force download
  app.get(["/api/download", "/download"], async (req, res) => {
    const { url, filename, type } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).send("URL is required");
    }

    try {
      const response = await axios({
        method: "get",
        url: url,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Referer": "https://www.instagram.com/",
        },
        timeout: 20000,
      });

      const contentType = response.headers["content-type"];
      
      // Source of truth is the actual content-type from the media server
      let ext = "bin";
      let finalContentType = contentType || "application/octet-stream";

      if (contentType?.includes("video")) {
        ext = "mp4";
        finalContentType = "video/mp4";
      } else if (contentType?.includes("image/jpeg") || contentType?.includes("image/jpg")) {
        ext = "jpg";
        finalContentType = "image/jpeg";
      } else if (contentType?.includes("image/png")) {
        ext = "png";
        finalContentType = "image/png";
      } else if (contentType?.includes("image/webp")) {
        ext = "webp";
        finalContentType = "image/webp";
      } else {
        // Fallback logic if content-type is missing or generic
        const isVideo = url.includes(".mp4") || url.includes("video") || req.query.type === "video";
        if (isVideo) {
          ext = "mp4";
          finalContentType = "video/mp4";
        } else {
          ext = "jpg";
          finalContentType = "image/jpeg";
        }
      }

      const finalFilename = filename ? `${filename}.${ext}` : `neoninsta_${Date.now()}.${ext}`;

      res.setHeader("Content-Disposition", `attachment; filename="${finalFilename}"`);
      res.setHeader("Content-Type", finalContentType);

      response.data.pipe(res);
    } catch (error: any) {
      console.error("Download proxy error:", error.message);
      res.status(500).send("Failed to download file");
    }
  });

  // Vite middleware for development (AI Studio Preview)
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
    // Serve static files in production mode (non-Vercel)
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    const PORT = Number(process.env.PORT) || 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

export default app;
