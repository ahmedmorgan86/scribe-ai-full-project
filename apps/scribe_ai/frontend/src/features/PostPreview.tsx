import React from 'react';
import { cn } from '../lib/utils';
import { Card } from '../components/ui/card';
import { SiInstagram, SiX, SiFacebook, SiTiktok, SiThreads } from 'react-icons/si';
import { Linkedin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Heart, MessageCircle, Share2, Bookmark, MoreHorizontal } from 'lucide-react';

interface PostPreviewProps {
  content: string;
  platform: string;
  className?: string;
}

const platformIcons: Record<string, any> = {
  Instagram: SiInstagram,
  LinkedIn: Linkedin,
  'Twitter/X': SiX,
  Facebook: SiFacebook,
  TikTok: SiTiktok,
  Threads: SiThreads,
};

const platformColors: Record<string, string> = {
  Instagram: 'text-pink-500',
  LinkedIn: 'text-blue-600',
  'Twitter/X': 'text-foreground',
  Facebook: 'text-blue-500',
  TikTok: 'text-pink-400',
  Threads: 'text-foreground',
};

export function PostPreview({ content, platform, className }: PostPreviewProps) {
  const Icon = platformIcons[platform] || SiX;
  const colorClass = platformColors[platform] || 'text-primary';

  const renderInstagram = () => (
    <div className="bg-card rounded-xl border overflow-hidden max-w-sm mx-auto shadow-xl">
      <div className="p-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8 ring-1 ring-pink-500 ring-offset-1 ring-offset-background">
            <AvatarImage src="" />
            <AvatarFallback className="bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white text-[10px]">AI</AvatarFallback>
          </Avatar>
          <span className="text-xs font-semibold">scribe_ai</span>
        </div>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="aspect-square bg-muted/20 flex items-center justify-center p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('./assets/texture-mesh-1.jpg')] opacity-20 bg-cover bg-center" />
        <div className="relative z-10 text-center space-y-2">
           <Icon className={cn("h-12 w-12 mx-auto opacity-20", colorClass)} />
           <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">معاينة المحتوى المرئي</p>
        </div>
      </div>
      <div className="p-3 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Heart className="h-5 w-5" />
            <MessageCircle className="h-5 w-5" />
            <Share2 className="h-5 w-5" />
          </div>
          <Bookmark className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold">١،٢٣٤ إعجاب</p>
          <p className="text-xs leading-relaxed">
            <span className="font-semibold ml-2">scribe_ai</span>
            {content}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase mt-1">منذ دقيقتين</p>
        </div>
      </div>
    </div>
  );

  const renderLinkedIn = () => (
    <div className="bg-card rounded-lg border p-4 shadow-xl max-w-md mx-auto" dir="rtl">
      <div className="flex items-start justify-between mb-3">
        <div className="flex gap-2">
          <Avatar className="h-12 w-12 rounded-none">
            <AvatarFallback className="bg-blue-600 text-white rounded-none">AI</AvatarFallback>
          </Avatar>
          <div className="flex flex-col text-right">
            <span className="text-sm font-semibold hover:text-blue-600 cursor-pointer">مساعد سكرايب الذكي</span>
            <span className="text-xs text-muted-foreground">خبير استراتيجية المحتوى</span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">دقيقة واحدة • 🌐</span>
          </div>
        </div>
        <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap mb-4 text-right">{content}</p>
      <div className="flex items-center justify-between border-t border-white/5 pt-3">
        <div className="flex items-center gap-4 text-muted-foreground w-full justify-between">
          <div className="flex items-center gap-1 text-xs hover:bg-muted p-1.5 rounded transition-colors cursor-pointer font-medium">
            👍 <span className="mr-1">أعجبني</span>
          </div>
          <div className="flex items-center gap-1 text-xs hover:bg-muted p-1.5 rounded transition-colors cursor-pointer font-medium">
            💬 <span>تعليق</span>
          </div>
          <div className="flex items-center gap-1 text-xs hover:bg-muted p-1.5 rounded transition-colors cursor-pointer font-medium">
            🔁 <span>إعادة نشر</span>
          </div>
          <div className="flex items-center gap-1 text-xs hover:bg-muted p-1.5 rounded transition-colors cursor-pointer font-medium">
            🕊️ <span>إرسال</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderGeneric = () => (
    <div className="bg-card/50 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden group text-right" dir="rtl">
      <div className="absolute top-0 left-0 p-4">
        <Icon className={cn("h-8 w-8 opacity-20 group-hover:opacity-100 transition-opacity", colorClass)} />
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className={cn("p-2 rounded-xl bg-primary/10", colorClass)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-heading font-bold text-sm">معاينة {platform === 'Instagram' ? 'إنستغرام' : platform === 'LinkedIn' ? 'لينكد إن' : platform}</h4>
          <p className="text-xs text-muted-foreground">محتوى محسّن بالذكاء الاصطناعي</p>
        </div>
      </div>
      <div className="prose prose-sm prose-invert max-w-none">
        <p className="text-base leading-relaxed whitespace-pre-wrap italic text-foreground/90">
          "{content}"
        </p>
      </div>
      <div className="mt-8 flex items-center gap-2">
        <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-primary w-full animate-shimmer" />
        </div>
        <span className="text-[10px] font-mono text-primary uppercase tracking-tighter">محقّق - يشبه البشر</span>
      </div>
    </div>
  );

  return (
    <div className={cn("w-full transition-all duration-500 animate-in fade-in slide-in-from-bottom-4", className)}>
      {platform === 'Instagram' ? renderInstagram() : platform === 'LinkedIn' ? renderLinkedIn() : renderGeneric()}
    </div>
  );
}
