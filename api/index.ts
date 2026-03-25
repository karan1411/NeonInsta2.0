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
    const shortcodeMatch = url.match(/\/(?:p|reels|reel)\/([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

    try {
      // Strategy 0: Direct JSON API (Fastest and most reliable if not blocked)
      if (shortcode && !isStory) {
        try {
          const jsonUrl = `${url}?__a=1&__d=dis`;
          const jsonResponse = await axios.get(jsonUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
              "X-IG-App-ID": "936619743392459",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": url,
            },
            timeout: 5000,
          });
          
          const media = jsonResponse.data?.graphql?.shortcode_media || jsonResponse.data?.items?.[0];
          if (media) {
            const results: any[] = [];
            const title = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text || "Instagram Media";

            // Handle carousel
            const carouselItems = media.edge_sidecar_to_children?.edges || media.carousel_media;
            if (carouselItems) {
              carouselItems.forEach((item: any) => {
                const node = item.node || item;
                const isVideo = node.is_video || !!node.video_versions;
                const vUrl = node.video_url || node.video_versions?.[0]?.url;
                const dUrl = node.display_url || node.image_versions2?.candidates?.[0]?.url;
                
                if (vUrl || dUrl) {
                  results.push({
                    mediaUrl: (isVideo && vUrl) ? vUrl : dUrl,
                    thumbnail: dUrl || vUrl,
                    type: isVideo ? "video" : "image",
                  });
                }
              });
            } else {
              const isVideo = media.is_video || !!media.video_versions;
              const vUrl = media.video_url || media.video_versions?.[0]?.url;
              const dUrl = media.display_url || media.image_versions2?.candidates?.[0]?.url;
              
              if (vUrl || dUrl) {
                results.push({
                  mediaUrl: (isVideo && vUrl) ? vUrl : dUrl,
                  thumbnail: dUrl || vUrl,
                  type: isVideo ? "video" : "image",
                });
              }
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

      // Strategy 0.5: Story API (if it's a story)
      if (isStory) {
        try {
          // Extract username from story URL
          const usernameMatch = url.match(/\/stories\/([^\/]+)/);
          const username = usernameMatch ? usernameMatch[1] : null;
          
          if (username) {
            // Add a small random delay to mimic human behavior
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
            
            const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
            // First get user info to get user ID
            const userInfoUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
            let userInfoResponse;
            try {
              userInfoResponse = await axios.get(userInfoUrl, {
                headers: {
                  "User-Agent": ua,
                  "X-IG-App-ID": "936619743392459",
                  "X-ASBD-ID": "129477",
                  "X-IG-WWW-Claim": "0",
                  "X-Requested-With": "XMLHttpRequest",
                  "Referer": `https://www.instagram.com/${username}/`,
                },
                timeout: 5000,
              });
            } catch (e: any) {
              console.error(`Story User Info Error for ${username}:`, e.message);
            }
            
            const user = userInfoResponse?.data?.data?.user;
            const userId = user?.id;
            const isPrivate = user?.is_private;

            if (isPrivate) {
              return res.status(403).json({ error: "This account is PRIVATE. We cannot download stories from private accounts." });
            }
            
            // Fallback: Try to get userId from HTML if API fails
            if (!userId) {
              try {
                const profileHtml = await axios.get(`https://www.instagram.com/${username}/`, {
                  headers: { "User-Agent": userAgents[0] }
                });
                const idMatch = profileHtml.data.match(/"user_id":"(\d+)"/) || profileHtml.data.match(/"id":"(\d+)"/);
                if (idMatch) userId = idMatch[1];
              } catch (e) {}
            }

            if (userId) {
              const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
              const storyApiUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
              let storyResponse;
              try {
                storyResponse = await axios.get(storyApiUrl, {
                  headers: {
                    "User-Agent": ua,
                    "X-IG-App-ID": "936619743392459",
                    "X-ASBD-ID": "129477",
                    "X-IG-WWW-Claim": "0",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": `https://www.instagram.com/stories/${username}/`,
                  },
                  timeout: 5000,
                });
              } catch (e: any) {
                console.error(`Story Reels Media Error for ${username}:`, e.message);
              }
              
              const reels = storyResponse?.data?.reels;
              if (reels && reels[userId]) {
                const items = reels[userId].items;
                const results: any[] = [];
                
                // If the URL has a specific story ID, find that one
                const storyIdMatch = url.match(/\/stories\/[^\/]+\/([0-9]+)/);
                const targetStoryId = storyIdMatch ? storyIdMatch[1] : null;
                
                items.forEach((item: any) => {
                  if (targetStoryId && !item.id.includes(targetStoryId)) return;
                  
                  const isVideo = !!item.video_versions;
                  const vUrl = item.video_versions?.[0]?.url;
                  const iUrl = item.image_versions2?.candidates?.[0]?.url;
                  
                  if (vUrl || iUrl) {
                    results.push({
                      mediaUrl: (isVideo && vUrl) ? vUrl : iUrl,
                      thumbnail: iUrl || vUrl,
                      type: isVideo ? "video" : "image",
                    });
                  }
                });
                
                if (results.length > 0) {
                  return res.json({
                    success: true,
                    results,
                    title: `Instagram Story by ${username}`,
                    isReel: false,
                    isStory: true
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
      const fetchInstagram = async (userAgent: string) => {
        return await axios.get(url, {
          headers: {
            "User-Agent": userAgent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "X-IG-App-ID": "936619743392459",
            "X-ASBD-ID": "129477",
            "X-IG-WWW-Claim": "0",
            "X-IG-Capabilities": "3brvPw==",
            "X-IG-Connection-Type": "WIFI",
            "X-Requested-With": "XMLHttpRequest",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
            "Referer": "https://www.instagram.com/",
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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
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
        if (!content) return;

        try {
          // Pattern 0: window.__additionalDataLoaded
          if (content.includes("__additionalDataLoaded")) {
            const dataMatch = content.match(/__additionalDataLoaded\s*\(\s*['"](.*?)['"]\s*,\s*(\{.*?\})\s*\)/);
            if (dataMatch) {
              const jsonData = JSON.parse(dataMatch[2]);
              const items = jsonData.items || [jsonData.graphql?.shortcode_media];
              
              items.forEach((item: any) => {
                if (!item) return;
                
                // Handle carousel
                if (item.carousel_media) {
                  item.carousel_media.forEach((m: any) => {
                    const isVideo = !!m.video_versions;
                    const vUrl = m.video_versions?.[0]?.url;
                    const iUrl = m.image_versions2?.candidates?.[0]?.url;
                    
                    if (vUrl || iUrl) {
                      results.push({
                        mediaUrl: (isVideo && vUrl) ? vUrl : iUrl,
                        thumbnail: iUrl || vUrl,
                        type: isVideo ? "video" : "image"
                      });
                    }
                  });
                } else {
                  const isVideo = !!item.video_versions;
                  const vUrl = item.video_versions?.[0]?.url;
                  const iUrl = item.image_versions2?.candidates?.[0]?.url;
                  
                  if (vUrl || iUrl) {
                    results.push({
                      mediaUrl: (isVideo && vUrl) ? vUrl : iUrl,
                      thumbnail: iUrl || vUrl,
                      type: isVideo ? "video" : "image"
                    });
                  }
                }
              });
            }
          }

          // Pattern 0.5: window._sharedData
          if (content.includes("_sharedData")) {
            const dataMatch = content.match(/window\._sharedData\s*=\s*(\{.*?\});/);
            if (dataMatch) {
              const jsonData = JSON.parse(dataMatch[1]);
              const entryData = jsonData.entry_data;
              if (entryData) {
                const pageData = entryData.PostPage?.[0]?.graphql?.shortcode_media || entryData.StoriesPage?.[0]?.reel?.items?.[0];
                if (pageData) {
                  const isVideo = pageData.is_video;
                  const vUrl = pageData.video_url;
                  const dUrl = pageData.display_url;
                  
                  if (vUrl || dUrl) {
                    results.push({
                      mediaUrl: (isVideo && vUrl) ? vUrl : dUrl,
                      thumbnail: dUrl || vUrl,
                      type: isVideo ? "video" : "image"
                    });
                  }
                }
              }
            }
          }
          const carouselMatches = content.match(/"edge_sidecar_to_children":\s*\{"edges":\s*\[(.*?)\]\}/g);
          if (carouselMatches) {
            carouselMatches.forEach(match => {
              const edgesMatch = match.match(/"node":\s*\{(.*?)\}/g);
              if (edgesMatch) {
                edgesMatch.forEach(m => {
                  const isVideo = m.includes('"is_video":true');
                  const videoUrl = m.match(/"video_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                  const displayUrl = m.match(/"display_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                  
                  if (displayUrl) {
                    results.push({
                      mediaUrl: isVideo && videoUrl ? videoUrl : displayUrl,
                      thumbnail: displayUrl,
                      type: isVideo ? "video" : "image"
                    });
                  }
                });
              }
            });
          }

          // Pattern 2: xdt_api__v1__media (Newer Instagram API structure)
          if (content.includes("xdt_api__v1__media")) {
            const mediaMatches = content.match(/"video_versions":\s*\[(.*?)\]/g);
            if (mediaMatches) {
              mediaMatches.forEach(m => {
                const urlMatch = m.match(/"url":"([^"]+)"/);
                if (urlMatch) {
                  const vUrl = urlMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                  if (!results.some(r => r.mediaUrl === vUrl)) {
                    results.push({
                      mediaUrl: vUrl,
                      thumbnail: vUrl,
                      type: "video"
                    });
                  }
                }
              });
            }
            
            const imageMatches = content.match(/"image_versions2":\s*\{"candidates":\s*\[(.*?)\]\}/g);
            if (imageMatches) {
              imageMatches.forEach(m => {
                const urlMatch = m.match(/"url":"([^"]+)"/);
                if (urlMatch) {
                  const iUrl = urlMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                  if (!results.some(r => r.mediaUrl === iUrl)) {
                    results.push({
                      mediaUrl: iUrl,
                      thumbnail: iUrl,
                      type: "image"
                    });
                  }
                }
              });
            }
          }

          // Pattern 3: Generic video_url/display_url search
          const videoUrlMatches = content.match(/"video_url":"([^"]+)"/g);
          if (videoUrlMatches) {
            videoUrlMatches.forEach(m => {
              const vUrl = m.match(/"video_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
              if (vUrl && !results.some(r => r.mediaUrl === vUrl)) {
                results.push({
                  mediaUrl: vUrl,
                  thumbnail: vUrl,
                  type: "video"
                });
              }
            });
          }
          
          const displayUrlMatches = content.match(/"display_url":"([^"]+)"/g);
          if (displayUrlMatches) {
            displayUrlMatches.forEach(m => {
              const dUrl = m.match(/"display_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
              if (dUrl && !results.some(r => r.mediaUrl === dUrl)) {
                results.push({
                  mediaUrl: dUrl,
                  thumbnail: dUrl,
                  type: "image"
                });
              }
            });
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
        // Try to find any direct video/image links in the whole HTML for stories
        const storyPatterns = [
          /"xdt_api__v1__media__direct_path":"([^"]+)"/,
          /"video_versions":\s*\[\s*\{\s*"url":"([^"]+)"/,
          /"image_versions2":\s*\{\s*"candidates":\s*\[\s*\{\s*"url":"([^"]+)"/,
          /"video_url":"([^"]+)"/,
          /"display_url":"([^"]+)"/
        ];

        for (const pattern of storyPatterns) {
          const matches = html.match(new RegExp(pattern, 'g'));
          if (matches) {
            matches.forEach(m => {
              const urlMatch = m.match(pattern);
              if (urlMatch) {
                const url = urlMatch[1];
                const decoded = url.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                if (!results.some(r => r.mediaUrl === decoded)) {
                  results.push({
                    mediaUrl: decoded,
                    thumbnail: decoded,
                    type: decoded.includes(".mp4") || decoded.includes("video") || decoded.includes("fbcdn") ? "video" : "image"
                  });
                }
              }
            });
          }
        }
        
        // Final fallback for stories: look for any large mp4/jpg in the HTML
        if (results.length === 0) {
           const mp4Matches = html.match(/https?:\/\/[^"'\s<>]+?\.mp4[^"'\s<>]*/g);
           if (mp4Matches) {
             mp4Matches.forEach(m => {
               const decoded = m.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
               if (!results.some(r => r.mediaUrl === decoded)) {
                 results.push({ mediaUrl: decoded, thumbnail: decoded, type: "video" });
               }
             });
           }
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
