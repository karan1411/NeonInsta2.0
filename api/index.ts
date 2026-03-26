import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const userAgents = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Instagram 219.0.0.12.117 Android (29/10; 480dpi; 1080x2220; samsung; SM-G973F; beyond1; exynos9820; en_GB; 340367919)",
  "Instagram 322.0.0.33.107 (iPhone15,2; iOS 17_3_1; en_US; en-US; scale=3.00; 1179x2556; 570773663)"
];

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
        const jsonEndpoints = [
          `${url}?__a=1&__d=dis`,
          `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
          `https://www.instagram.com/api/v1/media/info/?shortcode=${shortcode}`,
          `https://www.instagram.com/api/v1/media/shortcode_to_id/?shortcode=${shortcode}`,
          `https://i.instagram.com/api/v1/media/${shortcode}/info/`
        ];

        for (const jsonUrl of jsonEndpoints) {
          try {
            const isMobileApi = jsonUrl.includes("i.instagram.com");
            const jsonResponse = await axios.get(jsonUrl, {
              headers: {
                "User-Agent": isMobileApi ? userAgents[userAgents.length - 2] : userAgents[0],
                "X-IG-App-ID": "936619743392459",
                "X-ASBD-ID": "129477",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": url,
              },
              timeout: 6000,
            });
            
            let media = jsonResponse.data?.graphql?.shortcode_media || jsonResponse.data?.items?.[0] || jsonResponse.data?.data?.shortcode_media;
            
            // If we got a media ID instead of media info, try to fetch info using ID
            if (!media && jsonUrl.includes("shortcode_to_id")) {
              const mediaId = jsonResponse.data?.media_id;
              if (mediaId) {
                const idInfoUrl = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;
                const idInfoRes = await axios.get(idInfoUrl, {
                  headers: {
                    "User-Agent": userAgents[userAgents.length - 2],
                    "X-IG-App-ID": "936619743392459",
                  },
                  timeout: 5000
                });
                media = idInfoRes.data?.items?.[0];
              }
            }

            if (media) {
              console.log(`[Post] Found media via JSON API: ${jsonUrl}`);
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
                      type: isVideo ? 'video' : 'image',
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
                    type: isVideo ? 'video' : 'image',
                  });
                }
              }
              
              if (results.length > 0) {
                return res.json({
                  success: true,
                  results,
                  title,
                  isReel: url.includes('/reel/') || url.includes('/reels/'),
                  isStory
                });
              }
            }
          } catch (e) {}
        }
      }

      // Strategy 0.5: Story API (if it's a story)
      if (isStory) {
        try {
          // Extract username from story URL
          const usernameMatch = url.match(/\/stories\/([^\/]+)/);
          const username = usernameMatch ? usernameMatch[1] : null;
          
          if (username) {
            console.log(`[Story] Attempting to fetch for user: ${username}`);
            await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
            
            const ua = userAgents[0];
            let userId = null;
            let isPrivate = false;

            // Step 1: Get User ID
            try {
              // Try multiple endpoints for user info
              const userInfoEndpoints = [
                `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
                `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
                `https://www.instagram.com/web/search/topsearch/?context=blended&query=${username}`
              ];
              
              for (const endpoint of userInfoEndpoints) {
                try {
                  const userInfoResponse = await axios.get(endpoint, {
                    headers: {
                      "User-Agent": ua,
                      "X-IG-App-ID": "936619743392459",
                      "X-ASBD-ID": "129477",
                      "X-IG-WWW-Claim": "0",
                      "Accept": "*/*",
                      "Referer": `https://www.instagram.com/${username}/`,
                    },
                    timeout: 7000,
                  });
                  
                  if (endpoint.includes("topsearch")) {
                    const user = userInfoResponse.data?.users?.[0]?.user;
                    if (user?.username === username || user?.pk) {
                      userId = user.pk || user.id;
                      isPrivate = user.is_private;
                      console.log(`[Story] Found User ID via TopSearch: ${userId}`);
                      break;
                    }
                  } else {
                    const user = userInfoResponse?.data?.data?.user || userInfoResponse?.data?.user;
                    if (user?.id || user?.pk) {
                      userId = user.id || user.pk;
                      isPrivate = user.is_private;
                      console.log(`[Story] Found User ID via API (${endpoint}): ${userId}`);
                      break;
                    }
                  }
                } catch (e) {}
              }
            } catch (e: any) {
              console.log(`[Story] API User Info failed. Trying scraping...`);
            }

            if (!userId) {
              try {
                const profileRes = await axios.get(`https://www.instagram.com/${username}/`, {
                  headers: { "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)] },
                  timeout: 7000
                });
                const profileHtml = profileRes.data;
                const idMatch = profileHtml.match(/"id":"(\d+)"/) || 
                               profileHtml.match(/"user_id":"(\d+)"/) || 
                               profileHtml.match(/"pk":"(\d+)"/) ||
                               profileHtml.match(/"owner":\{"id":"(\d+)"\}/) ||
                               profileHtml.match(/"profile_id":"(\d+)"/);
                if (idMatch) userId = idMatch[1];
                isPrivate = profileHtml.includes('"is_private":true');
                console.log(`[Story] Found User ID via scraping: ${userId}`);
              } catch (err) {}
            }

            if (isPrivate) {
              return res.status(403).json({ error: "This account is PRIVATE. We cannot download stories from private accounts." });
            }

            if (userId) {
              // Get target story ID from URL if present
              const storyIdMatch = url.match(/\/stories\/[^\/]+\/([0-9]+)/);
              const targetStoryId = storyIdMatch ? storyIdMatch[1] : null;
              
              const results: any[] = [];

              // Strategy A: Reels Media API
              try {
                const storyApiUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
                const storyResponse = await axios.get(storyApiUrl, {
                  headers: {
                    "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
                    "X-IG-App-ID": "936619743392459",
                    "X-ASBD-ID": "129477",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": `https://www.instagram.com/stories/${username}/`,
                  },
                  timeout: 8000,
                });

                const reel = storyResponse.data?.reels?.[userId];
                if (reel && reel.items) {
                  reel.items.forEach((item: any) => {
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
                }
              } catch (e: any) {
                console.log(`[Story] Reels Media API failed: ${e.message}`);
              }

              // Strategy B: Media Info API (if targetStoryId exists)
              if (results.length === 0 && targetStoryId) {
                try {
                  console.log(`[Story] Trying Media Info API for ${targetStoryId}`);
                  const mediaInfoUrl = `https://www.instagram.com/api/v1/media/${targetStoryId}/info/`;
                  const mediaRes = await axios.get(mediaInfoUrl, {
                    headers: {
                      "User-Agent": userAgents[0],
                      "X-IG-App-ID": "936619743392459",
                    },
                    timeout: 7000
                  });
                  if (mediaRes.data?.items?.[0]) {
                    const item = mediaRes.data.items[0];
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
                  }
                } catch (e) {}
              }

              // Strategy B.5: Direct Reel URL Fallback (if targetStoryId exists)
              if (results.length === 0 && targetStoryId) {
                try {
                  console.log(`[Story] Trying direct Reel URL fallback for ${targetStoryId}`);
                  const reelUrls = [
                    `https://www.instagram.com/reels/${targetStoryId}/`,
                    `https://www.instagram.com/p/${targetStoryId}/`
                  ];
                  
                  for (const rUrl of reelUrls) {
                    try {
                      const reelRes = await axios.get(rUrl, {
                        headers: { "User-Agent": userAgents[0] },
                        timeout: 5000
                      });
                      const reelHtml = reelRes.data;
                      const mediaRegex = /https?(?:\\\/\\\/|:\/\/)[^"'\\s<>]+?\.(?:mp4|jpg|webp)(?:[^"'\\s<>]*)/g;
                      const mediaMatches = reelHtml.match(mediaRegex);
                      if (mediaMatches) {
                        mediaMatches.forEach((m: string) => {
                          const decoded = m.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                          if (decoded.includes("fbcdn.net") && !results.some(r => r.mediaUrl === decoded)) {
                            results.push({ 
                              mediaUrl: decoded, 
                              thumbnail: decoded, 
                              type: decoded.includes(".mp4") ? "video" : "image" 
                            });
                          }
                        });
                      }
                      if (results.length > 0) break;
                    } catch (e) {}
                  }
                } catch (e) {}
              }

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
            
            // Strategy C: Direct Page Scraping (Plan C)
            try {
              console.log(`[Story] Trying direct page scraping for ${url}`);
              const storyPageRes = await axios.get(url, {
                headers: { "User-Agent": userAgents[0] },
                timeout: 7000
              });
              const storyHtml = storyPageRes.data;
              
              // Look for any direct media links in the HTML
              const mediaRegex = /https?(?:\\\/\\\/|:\/\/)[^"'\\s<>]+?\.(?:mp4|jpg|webp)(?:[^"'\\s<>]*)/g;
              const mediaMatches = storyHtml.match(mediaRegex);
              
              if (mediaMatches) {
                const scrapedResults: any[] = [];
                mediaMatches.forEach((m: string) => {
                  const decoded = m.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                  if (decoded.includes("fbcdn.net") && !scrapedResults.some(r => r.mediaUrl === decoded)) {
                    scrapedResults.push({ 
                      mediaUrl: decoded, 
                      thumbnail: decoded, 
                      type: decoded.includes(".mp4") ? "video" : "image" 
                    });
                  }
                });
                
                if (scrapedResults.length > 0) {
                  // If we have a target ID, we might have multiple stories in the HTML.
                  // Usually the first one or the one with the most similar ID is the target.
                  return res.json({
                    success: true,
                    results: scrapedResults,
                    title: `Instagram Story by ${username}`,
                    isReel: false,
                    isStory: true
                  });
                }
              }
            } catch (e) {}
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

      let response;
      let html = "";
      
      // Try different user agents if blocked
      for (const ua of userAgents) {
        try {
          response = await fetchInstagram(ua);
          const finalUrl = response.request.res.responseUrl || url;
          
          // Even if it redirects to login, we might get some HTML content
          html = response.data;
          
          if (!finalUrl.includes("accounts/login")) {
            if (html.includes("video_url") || html.includes("video_versions") || html.includes(".mp4")) {
              break;
            }
          }
        } catch (e) {}
      }

      // Strategy 2: GraphQL Fallback (if no video found yet)
      if (shortcode && (!html || !html.includes(".mp4"))) {
        const queryHashes = [
          "b7d3d6544695990391a4f148fdd9c063",
          "d4d88dc917f0ecf41f11730700793b17",
          "9f8885144456a65948f33d3610c6ad42",
          "2c5d4d8b70cad329c4a6ebe3abb6edd4",
          "55a3c4ba2973540007748315579b77d5"
        ];

        for (const hash of queryHashes) {
          try {
            console.log(`[Post] Trying GraphQL Fallback (${hash}) for ${shortcode}`);
            const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${hash}&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
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
              console.log(`[Post] Found media via GraphQL (${hash})`);
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
      }

      if (!html) {
        console.log(`[Post] No HTML fetched after all attempts`);
        return res.status(403).json({ error: "Instagram is currently blocking our server. This happens because they protect their content aggressively. Please try again in 2-3 minutes." });
      }

      console.log(`[Post] Parsing HTML for ${url}`);
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
        console.log(`[Post] Using OG Tags fallback`);
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

      // 4. Aggressive Extraction (Plan D)
      if (results.length === 0) {
        console.log("[Post] Plan D: Aggressive Extraction...");
        const mediaRegex = /https?(?:\\\/\\\/|:\/\/)[^"'\\s<>]+?\.(?:mp4|jpg|webp)(?:[^"'\\s<>]*)/g;
        const mediaMatches = html.match(mediaRegex);
        
        if (mediaMatches) {
          mediaMatches.forEach(m => {
            const decoded = m.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
            if (decoded.includes("fbcdn.net") && !results.some(r => r.mediaUrl === decoded)) {
              results.push({ 
                mediaUrl: decoded, 
                thumbnail: decoded, 
                type: decoded.includes(".mp4") ? "video" : "image" 
              });
            }
          });
        }
      }

      // 5. Plan E: Deep JSON Scan
      if (results.length === 0) {
        console.log("[Post] Plan E: Deep JSON Scan...");
        const jsonRegex = /\{"node":\s*\{"__typename":"Graph(?:Image|Video|Sidecar)",.*?\}/g;
        const jsonMatches = html.match(jsonRegex);
        if (jsonMatches) {
          jsonMatches.forEach(match => {
            try {
              const node = JSON.parse(match).node;
              const isVideo = node.is_video;
              const vUrl = node.video_url;
              const dUrl = node.display_url;
              if (vUrl || dUrl) {
                results.push({
                  mediaUrl: isVideo && vUrl ? vUrl : dUrl,
                  thumbnail: dUrl || vUrl,
                  type: isVideo ? "video" : "image"
                });
              }
            } catch (e) {}
          });
        }
      }

      // 6. Plan F: Script Tag Search
      if (results.length === 0) {
        console.log("[Post] Plan F: Script Tag Search...");
        $("script").each((_, script) => {
          const content = $(script).html();
          if (!content) return;
          
          if (content.includes("video_url") || content.includes("display_url")) {
            const vMatches = content.match(/"video_url":"([^"]+)"/g);
            const dMatches = content.match(/"display_url":"([^"]+)"/g);
            
            if (vMatches) {
              vMatches.forEach(m => {
                const url = m.match(/"video_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                if (url && url.includes("fbcdn.net")) {
                  results.push({ mediaUrl: url, thumbnail: url, type: "video" });
                }
              });
            }
            if (dMatches) {
              dMatches.forEach(m => {
                const url = m.match(/"display_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/\\\//g, "/");
                if (url && url.includes("fbcdn.net")) {
                  results.push({ mediaUrl: url, thumbnail: url, type: "image" });
                }
              });
            }
          }
        });
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
