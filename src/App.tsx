import React, { useState } from 'react';
import { Download, Instagram, Link as LinkIcon, Loader2, AlertCircle, CheckCircle2, Github, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MediaItem {
  mediaUrl: string;
  thumbnail: string;
  type: 'video' | 'image';
}

interface MediaData {
  results: MediaItem[];
  title: string;
  isReel?: boolean;
  isStory?: boolean;
  videoFound?: boolean;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaData | null>(null);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/fetch-insta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      // Check if response is actually JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response received:", text);
        throw new Error(`Server returned HTML instead of JSON. Status: ${response.status}. Please check Vercel logs.`);
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch media');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (item: MediaItem) => {
    const downloadUrl = `/api/download?url=${encodeURIComponent(item.mediaUrl)}&filename=neoninsta_${Date.now()}&type=${item.type}`;
    window.location.href = downloadUrl;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,243,255,0.05),transparent_70%)]" />
      <div className="scanline" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl z-10"
      >
        {/* Header */}
        <div className="text-center mb-12">
          <motion.div 
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center justify-center p-4 rounded-2xl bg-black border border-neon-cyan/30 mb-6 neon-glow-cyan"
          >
            <Instagram className="w-10 h-10 text-neon-cyan" />
          </motion.div>
          <h1 className="text-5xl font-black tracking-tighter mb-4 neon-text-cyan">
            NEON<span className="text-neon-pink">INSTA</span>
          </h1>
          <p className="text-zinc-400 text-lg font-medium">
            Download Reels, Stories, Videos, and Photos in high quality.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleFetch} className="relative group mb-8">
          <div className="absolute -inset-1 bg-gradient-to-r from-neon-cyan to-neon-pink rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
          <div className="relative flex items-center bg-[#0a0a0a] border border-white/10 rounded-2xl p-2">
            <div className="pl-4 pr-2 text-zinc-500">
              <LinkIcon className="w-5 h-5" />
            </div>
            <input 
              type="text" 
              placeholder="Paste link (Reel, Story, Post, Highlight)..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-zinc-600 py-4 text-lg"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button 
              type="submit"
              disabled={loading || !url}
              className={cn(
                "px-8 py-4 rounded-xl font-bold transition-all duration-300 flex items-center gap-2",
                loading || !url 
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                  : "bg-neon-cyan text-black hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.5)] active:scale-95"
              )}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              {loading ? 'FETCHING...' : 'DOWNLOAD'}
            </button>
          </div>
        </form>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8"
            >
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3 text-red-400">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result Card */}
        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="text-center mb-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-neon-lime" />
                  <span className="text-xs font-bold text-neon-lime uppercase tracking-widest">
                    {result.results.length} {result.results.length > 1 ? 'Items' : 'Item'} Found
                  </span>
                  {result.isReel && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30">
                      REEL
                    </span>
                  )}
                  {result.isStory && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase bg-neon-pink/20 text-neon-pink border border-neon-pink/30">
                      STORY
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-white mt-4 line-clamp-2 px-4">
                  {result.title}
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {result.results.map((item, index) => (
                  <motion.div 
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="relative group/card"
                  >
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-pink to-neon-cyan rounded-3xl blur opacity-0 group-hover/card:opacity-20 transition duration-500" />
                    <div className="relative bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden flex flex-col">
                      <div className="aspect-square relative overflow-hidden bg-zinc-900 border-b border-white/5">
                        <img 
                          src={item.thumbnail} 
                          alt={`Media ${index + 1}`} 
                          className="w-full h-full object-cover group-hover/card:scale-105 transition duration-700"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-black text-white uppercase tracking-widest">
                          {item.type}
                        </div>
                      </div>
                      <div className="p-4">
                        <button 
                          onClick={() => handleDownload(item)}
                          className="w-full py-3 bg-white text-black font-black rounded-xl hover:scale-[1.02] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 shadow-xl"
                        >
                          <Download className="w-4 h-4" />
                          DOWNLOAD {item.type === 'video' ? 'VIDEO' : 'PHOTO'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {result.isReel && result.results.every(r => r.type === 'image') && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3 text-amber-400 max-w-xl mx-auto">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <p className="text-sm font-medium leading-relaxed">
                      Instagram is protecting the video link for this Reel. We found the high-quality thumbnail, but the full video is currently restricted.
                    </p>
                    <button 
                      onClick={(e) => handleFetch(e as any)}
                      className="text-[10px] font-black uppercase tracking-widest bg-amber-500/20 px-4 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/40 transition-colors flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Deep Scan
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-16">
          {[
            { label: 'Fast Speed', desc: 'Instant media extraction' },
            { label: 'No Login', desc: 'Download public content' },
            { label: 'All Content', desc: 'Reels, Stories, Posts & Highlights' }
          ].map((feature, i) => (
            <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center">
              <h4 className="text-neon-cyan text-sm font-bold uppercase tracking-widest mb-1">{feature.label}</h4>
              <p className="text-zinc-500 text-xs">{feature.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Footer */}
      <footer className="mt-20 text-zinc-600 text-sm flex flex-col items-center gap-4 z-10">
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-neon-cyan transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-neon-cyan transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-neon-cyan transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2">
          <span>Built for the community</span>
          <span className="w-1 h-1 rounded-full bg-zinc-800" />
          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <Github className="w-4 h-4" />
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
