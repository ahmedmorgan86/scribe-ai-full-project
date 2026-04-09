import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  Send, 
  Copy, 
  RefreshCcw, 
  Video, 
  ImageIcon, 
  Hash, 
  Zap, 
  CheckCircle2, 
  AlertCircle,
  Share2,
  ExternalLink,
  ChevronRight,
  Monitor,
  Smartphone,
  Edit3
} from 'lucide-react';
import { 
  SiInstagram, 
  SiX, 
  SiFacebook, 
  SiTiktok, 
  SiYoutube, 
  SiThreads 
} from 'react-icons/si';
import { FaLinkedinIn } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { Separator } from '../components/ui/separator';
import { streamCall, rpcCall, invalidateCache } from '../api';
import { cn } from '../lib/utils';

const PLATFORMS = [
  { id: 'Instagram', label: 'إنستغرام', icon: SiInstagram, color: '#E4405F' },
  { id: 'LinkedIn', label: 'لينكد إن', icon: FaLinkedinIn, color: '#0A66C2' },
  { id: 'X (Twitter)', label: 'إكس (تويتر)', icon: SiX, color: '#000000' },
  { id: 'TikTok', label: 'تيك توك', icon: SiTiktok, color: '#000000' },
  { id: 'YouTube', label: 'يوتيوب', icon: SiYoutube, color: '#FF0000' },
  { id: 'Facebook', label: 'فيسبوك', icon: SiFacebook, color: '#1877F2' }
];

const FORMULAS = [
  { id: 'local', label: 'اللهجات المحلية' },
  { id: 'storytelling', label: 'سرد القصص' },
  { id: 'educational', label: 'تعليمي / نصائح' },
  { id: 'controversial', label: 'مثير للجدل (بذكاء)' }
];

const DIALECTS = [
  { id: 'gulf', label: 'خليجي' },
  { id: 'egyptian', label: 'مصري' },
  { id: 'levantine', label: 'شامي' },
  { id: 'standard', label: 'عربية فصحى' }
];

export function CreativeStudio({ onComplete }: { onComplete?: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [platform, setPlatform] = useState('Instagram');
  const [formula, setFormula] = useState('local');
  const [dialect, setDialect] = useState('gulf');
  const [previewMode, setPreviewMode] = useState<'mobile' | 'desktop'>('mobile');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setStatus('بدء التوليد...');
    setProgress(5);
    setResult(null);
    setError(null);

    try {
      await streamCall({
        func: 'generate_content_streaming',
        args: { prompt, platform, formula, dialect },
        onChunk: (chunk) => {
          if (chunk.status) setStatus(chunk.status);
          if (chunk.progress) setProgress(chunk.progress);
          if (chunk.result) {
            setResult(chunk.result);
            invalidateCache(['get_posts']);
          }
          if (chunk.error) setError(chunk.error);
        },
        onError: (err) => setError(err.message)
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
      if (onComplete) onComplete();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 h-full animate-in fade-in slide-in-from-right-4 duration-700" dir="rtl">
      {/* Right Column - Generation Panel */}
      <div className="lg:w-[400px] flex flex-col gap-6 lg:border-l border-primary/5 lg:pl-8">
        <div className="space-y-2">
          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/10">استوديو الإبداع</Badge>
          <h2 className="text-3xl font-heading font-black">ابتكر محتواك</h2>
          <p className="text-muted-foreground text-sm">صف المحتوى الذي تريده وسأقوم بكتابة أفضل منشور لك.</p>
        </div>

        <Card className="glass border-primary/10 bg-card/60 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <CardContent className="p-6 space-y-6">
            <div className="space-y-3">
              <label htmlFor="prompt-input" className="text-xs font-black text-muted-foreground uppercase tracking-wider">الفكرة أو الموضوع</label>
              <Textarea 
                id="prompt-input"
                placeholder="مثال: أعلن عن افتتاح فرع جديد لمطعم شاورما في الرياض..."
                className="min-h-[140px] resize-none bg-background/50 border-primary/10 focus:border-primary/40 transition-all text-base leading-relaxed"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isGenerating}
                data-testid="prompt-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label id="platform-label" className="text-xs font-black text-muted-foreground uppercase tracking-wider">المنصة</label>
                <Select value={platform} onValueChange={setPlatform} disabled={isGenerating}>
                  <SelectTrigger id="platform-select-trigger" aria-label="اختر المنصة" className="bg-background/50 border-primary/10" aria-labelledby="platform-label" data-testid="platform-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.id} value={p.id} data-testid={`platform-option-${p.id}`}>
                        <div className="flex items-center gap-2">
                          <p.icon className="h-4 w-4" style={{ color: p.color }} />
                          <span>{p.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label id="dialect-label" className="text-xs font-black text-muted-foreground uppercase tracking-wider">اللهجة</label>
                <Select value={dialect} onValueChange={setDialect} disabled={isGenerating}>
                  <SelectTrigger id="dialect-select-trigger" aria-label="اختر اللهجة" className="bg-background/50 border-primary/10" aria-labelledby="dialect-label" data-testid="dialect-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIALECTS.map(d => (
                      <SelectItem key={d.id} value={d.id} data-testid={`dialect-option-${d.id}`}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label id="formula-label" className="text-xs font-black text-muted-foreground uppercase tracking-wider">معادلة المحتوى</label>
              <Select value={formula} onValueChange={setFormula} disabled={isGenerating}>
                <SelectTrigger id="formula-select-trigger" aria-label="اختر معادلة المحتوى" className="bg-background/50 border-primary/10" aria-labelledby="formula-label" data-testid="formula-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMULAS.map(f => (
                    <SelectItem key={f.id} value={f.id} data-testid={`formula-option-${f.id}`}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              className="w-full h-14 text-lg font-black gap-3 shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all active:scale-[0.98]" 
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              data-testid="generate-button"
            >
              {isGenerating ? (
                <>
                  <RefreshCcw className="h-5 w-5 animate-spin" />
                  جاري الابتكار...
                </>
              ) : (
                <>
                  <Zap className="h-5 w-5 fill-current" />
                  توليد المحتوى الذكي
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive animate-in slide-in-from-top-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>خطأ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Left Column - Preview & Full-screen Generation State */}
      <div className="flex-1 min-h-[600px] flex flex-col relative rounded-3xl overflow-hidden border border-primary/5 bg-primary/5 p-4 md:p-8">
        <div className="absolute inset-0 bg-[url('./assets/texture-mesh-1.jpg')] bg-cover bg-center opacity-5 z-0" />
        
        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div 
              key="generating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="relative z-10 h-full flex flex-col items-center justify-center text-center p-10"
            >
              <div className="w-full max-w-md space-y-12">
                <div className="relative h-48 w-48 mx-auto">
                   <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl animate-pulse" />
                   <div className="absolute inset-0 flex items-center justify-center">
                     <div className="h-32 w-32 rounded-full border-t-4 border-l-4 border-primary animate-spin" />
                   </div>
                   <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="h-16 w-16 text-primary animate-bounce" />
                   </div>
                </div>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-3xl font-black font-heading text-primary">{status}</h3>
                    <p className="text-muted-foreground font-medium">نقوم الآن بتحليل السوق وصياغة أفضل كلمات تجذب جمهورك.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-black mb-1">
                      <span>اكتمال العملية</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-3 bg-primary/10 shadow-inner" />
                  </div>
                </div>
              </div>
            </motion.div>
          ) : result ? (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative z-10 h-full flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                   <div className="p-2 rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                     <Monitor className="h-5 w-5" />
                   </div>
                   <h3 className="text-xl font-black font-heading tracking-tight">معاينة المنشور</h3>
                </div>
                <div className="flex bg-card/40 backdrop-blur-md rounded-full p-1 border border-primary/5">
                  <Button 
                    variant={previewMode === 'mobile' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    className="rounded-full h-8 px-4 text-[11px] font-bold"
                    onClick={() => setPreviewMode('mobile')}
                  >
                    <Smartphone className="h-3 w-3 ml-1.5" /> جوال
                  </Button>
                  <Button 
                    variant={previewMode === 'desktop' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    className="rounded-full h-8 px-4 text-[11px] font-bold"
                    onClick={() => setPreviewMode('desktop')}
                  >
                    <Monitor className="h-3 w-3 ml-1.5" /> حاسوب
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-4">
                 <div className={cn(
                   "transition-all duration-500 bg-card rounded-3xl shadow-2xl border border-primary/10 overflow-hidden flex flex-col",
                   previewMode === 'mobile' ? "w-[340px] h-[600px]" : "w-full max-w-2xl h-[450px]"
                 )}>
                   <div className="p-4 border-b border-primary/5 bg-primary/5 flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-violet-500" />
                      <div>
                        <div className="text-[11px] font-black">{platform}</div>
                        <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">الآن</div>
                      </div>
                   </div>
                   <ScrollArea className="flex-1 p-6">
                      <p className="text-lg leading-relaxed whitespace-pre-wrap font-medium">{result.content}</p>
                      
                      <div className="mt-8 flex flex-wrap gap-2">
                         {result.hashtags?.map((tag: string, i: number) => (
                           <span key={i} className="text-primary font-black text-sm hover:underline cursor-pointer">#{tag}</span>
                         ))}
                      </div>

                      <div className="mt-10 grid gap-4">
                         <div className="p-4 rounded-2xl bg-muted/30 border border-primary/5 space-y-3">
                            <div className="flex items-center gap-2 text-primary font-black text-xs uppercase tracking-widest">
                               <Video className="h-3 w-3" /> أفكار الفيديوهات المقترحة
                            </div>
                            {result.video_ideas?.map((v: string, i: number) => (
                              <p key={i} className="text-sm bg-background/50 p-3 rounded-xl border border-border/50">{v}</p>
                            ))}
                         </div>
                      </div>
                   </ScrollArea>
                   <div className="p-4 border-t border-primary/5 bg-muted/20 flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <div className="text-sm font-black text-primary">{result.scores?.human_score}%</div>
                          <div className="text-[8px] text-muted-foreground font-black uppercase tracking-tighter">نقاوة</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-black text-violet-400">{result.scores?.engagement}%</div>
                          <div className="text-[8px] text-muted-foreground font-black uppercase tracking-tighter">تفاعل</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(result.content)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="sm" className="h-9 font-bold px-6">نشر</Button>
                      </div>
                   </div>
                 </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative z-10 h-full flex flex-col items-center justify-center text-center p-8"
            >
              <div className="p-6 rounded-full bg-primary/5 mb-6">
                <Sparkles className="h-16 w-16 text-primary/20" />
              </div>
              <h3 className="text-2xl font-black font-heading text-muted-foreground/60">جاهز للإبداع؟</h3>
              <p className="text-muted-foreground max-w-md mt-4 font-medium">أدخل تفاصيل منشورك على اليمين وسنقوم بتوليد محتوى متكامل مع معاينة فورية في ثوانٍ.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
