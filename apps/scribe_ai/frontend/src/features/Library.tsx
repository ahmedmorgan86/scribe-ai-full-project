import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from '../components/ui/table';
import { rpcCall, invalidateCache } from '../api';
import { 
  Search, 
  Filter, 
  Trash2, 
  Copy, 
  ExternalLink, 
  Calendar, 
  MoreVertical,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  LayoutGrid,
  List,
  Eye,
  Download
} from 'lucide-react';
import { cn } from '../lib/utils';
import { FaLinkedinIn } from 'react-icons/fa';
import { SiInstagram, SiX, SiFacebook, SiTiktok, SiYoutube } from 'react-icons/si';

const PLATFORM_ICONS: Record<string, any> = {
  'Instagram': SiInstagram,
  'LinkedIn': FaLinkedinIn,
  'X (Twitter)': SiX,
  'Twitter/X': SiX,
  'Facebook': SiFacebook,
  'TikTok': SiTiktok,
  'YouTube': SiYoutube,
};

export function Library() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('grid');

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await rpcCall({ func: 'get_posts', args: { limit: 100 } });
      setPosts(data || []);
    } catch (err) {
      console.error("Failed to load library", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Invalidate cache on mount to ensure we have the latest generated posts
    invalidateCache(['get_posts']);
    loadPosts();
  }, [loadPosts]);

  const handleDelete = async (id: number) => {
    const previous = posts;
    setPosts(posts.filter(p => p.id !== id));
    try {
      await rpcCall({ func: 'delete_post', args: { post_id: id } });
      invalidateCache(['get_posts']);
    } catch (err) {
      setPosts(previous);
    }
  };

  const filteredPosts = posts.filter(p => 
    p.content?.toLowerCase().includes(search.toLowerCase()) || 
    p.original_prompt?.toLowerCase().includes(search.toLowerCase()) ||
    p.platform?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700" dir="rtl">
      {/* Search Header */}
      <Card className="glass-heavy border-primary/10 overflow-hidden relative shadow-2xl shadow-primary/5">
        <div className="absolute inset-0 bg-gradient-to-l from-primary/5 via-transparent to-transparent pointer-events-none" />
        <CardContent className="p-8 space-y-8 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2">
               <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">المكتبة</Badge>
               <h2 className="text-4xl font-black font-heading tracking-tight">مكتبة المحتوى</h2>
               <p className="text-muted-foreground font-medium">أرشيف كامل لجميع إبداعاتك ومسوداتك المنظمة.</p>
            </div>
            <div className="flex items-center gap-2 bg-background/40 backdrop-blur-md rounded-2xl p-1 border border-primary/5 shadow-inner">
               <Button 
                variant={view === 'grid' ? 'secondary' : 'ghost'} 
                size="sm" 
                className="h-9 px-5 rounded-xl font-bold gap-2"
                onClick={() => setView('grid')}
                data-testid="view-grid-toggle"
               >
                 <LayoutGrid className="h-4 w-4" /> شبكة
               </Button>
               <Button 
                variant={view === 'list' ? 'secondary' : 'ghost'} 
                size="sm" 
                className="h-9 px-5 rounded-xl font-bold gap-2"
                onClick={() => setView('list')}
                data-testid="view-list-toggle"
               >
                 <List className="h-4 w-4" /> قائمة
               </Button>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            </div>
            <input 
              type="text" 
              placeholder="ابحث في المحتوى، المنصات، أو الأفكار..." 
              className="w-full h-14 bg-background/60 border border-primary/10 rounded-2xl pr-12 pl-6 text-lg focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-muted-foreground/50 shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في المحتوى"
              data-testid="library-search-input"
            />
            <div className="absolute inset-y-0 left-0 pl-2 flex items-center">
               <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:bg-primary/5 hover:text-primary" aria-label="تصفية المحتوى">
                 <Filter className="h-5 w-5" />
               </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl bg-primary/5" />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center glass border-dashed border-2 rounded-3xl border-primary/10">
          <div className="p-8 rounded-full bg-primary/5 mb-6">
            <LayoutDashboard className="h-16 w-16 text-primary/10" />
          </div>
          <h3 className="text-2xl font-black font-heading tracking-tight">لا يوجد نتائج</h3>
          <p className="text-muted-foreground mt-4 max-w-sm font-medium leading-relaxed">جرب البحث بكلمات أخرى أو ابدأ بتوليد محتوى جديد من استوديو الإبداع.</p>
          <Button variant="outline" className="mt-8 px-10 h-12 rounded-full font-bold border-primary/20 hover:bg-primary/5 transition-all" onClick={() => setSearch('')}>مسح البحث</Button>
        </div>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20" data-testid="library-grid">
              {filteredPosts.map((post) => {
                const Icon = PLATFORM_ICONS[post.platform] || LayoutDashboard;
                return (
                  <Card key={post.id} className="glass group hover:shadow-2xl hover:shadow-primary/10 transition-all duration-500 border-primary/10 flex flex-col h-full overflow-hidden rounded-2xl active:scale-[0.99]" data-testid="post-card">
                    <CardHeader className="pb-4 border-b border-primary/5 bg-primary/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-xl bg-background shadow-md shadow-primary/5 text-primary">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="font-black text-sm tracking-tight">{post.platform}</span>
                        </div>
                        <Badge variant={post.status === 'منشور' ? 'default' : 'secondary'} className={cn(
                          "text-[9px] py-0 font-bold uppercase tracking-widest px-2.5",
                          post.status === 'منشور' ? "bg-emerald-500/20 text-emerald-500 border-transparent" : "bg-amber-500/20 text-amber-500 border-transparent"
                        )}>
                          {post.status === 'published' ? 'منشور' : 'مسودة'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6 flex-1">
                      <p className="text-base leading-relaxed text-muted-foreground font-medium line-clamp-6">
                        {post.content}
                      </p>
                    </CardContent>
                    <CardFooter className="pt-2 pb-6 px-6 flex flex-col gap-4">
                      <div className="flex items-center justify-between w-full text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(post.created_at).toLocaleDateString('ar-SA')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-violet-400">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{post.scores?.engagement || 0}% تفاعل</span>
                        </div>
                      </div>
                      <div className="flex gap-2 w-full">
                        <Button variant="outline" size="sm" className="flex-1 text-xs h-10 font-bold gap-2 rounded-xl border-primary/5 hover:bg-primary/5 hover:text-primary transition-all" onClick={() => navigator.clipboard.writeText(post.content)}>
                          <Copy className="h-4 w-4" /> نسخ
                        </Button>
                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 text-destructive border-destructive/10 hover:bg-destructive/10 hover:text-destructive rounded-xl transition-all" onClick={() => handleDelete(post.id)} aria-label="حذف المنشور">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="glass border-primary/5 overflow-hidden rounded-3xl shadow-xl">
               <Table data-testid="library-list">
                 <TableHeader className="bg-primary/5">
                   <TableRow className="border-primary/5 hover:bg-transparent">
                     <TableHead className="text-right font-black text-xs uppercase tracking-widest text-muted-foreground px-6 h-14">المنصة</TableHead>
                     <TableHead className="text-right font-black text-xs uppercase tracking-widest text-muted-foreground px-6 h-14">المحتوى</TableHead>
                     <TableHead className="text-right font-black text-xs uppercase tracking-widest text-muted-foreground px-6 h-14">الحالة</TableHead>
                     <TableHead className="text-right font-black text-xs uppercase tracking-widest text-muted-foreground px-6 h-14">التاريخ</TableHead>
                     <TableHead className="text-left font-black text-xs uppercase tracking-widest text-muted-foreground px-6 h-14">الإجراءات</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {filteredPosts.map((post) => {
                     const Icon = PLATFORM_ICONS[post.platform] || LayoutDashboard;
                     return (
                       <TableRow key={post.id} className="border-primary/5 hover:bg-primary/5 transition-colors group">
                         <TableCell className="px-6 h-20">
                           <div className="flex items-center gap-3">
                              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                <Icon className="h-4 w-4" />
                              </div>
                              <span className="font-bold text-sm">{post.platform}</span>
                           </div>
                         </TableCell>
                         <TableCell className="px-6 h-20 max-w-md">
                           <p className="text-sm text-muted-foreground font-medium truncate">{post.content}</p>
                         </TableCell>
                         <TableCell className="px-6 h-20">
                            <Badge variant={post.status === 'منشور' ? 'default' : 'secondary'} className={cn(
                              "text-[9px] py-0 font-bold",
                              post.status === 'منشور' ? "bg-emerald-500/20 text-emerald-500 border-transparent" : "bg-amber-500/20 text-amber-500 border-transparent"
                            )}>
                              {post.status === 'published' ? 'منشور' : 'مسودة'}
                            </Badge>
                         </TableCell>
                         <TableCell className="px-6 h-20 text-xs text-muted-foreground font-bold">
                           {new Date(post.created_at).toLocaleDateString('ar-SA')}
                         </TableCell>
                         <TableCell className="px-6 h-20 text-left">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-primary/10 hover:text-primary transition-all" aria-label="عرض">
                                 <Eye className="h-4 w-4" />
                               </Button>
                               <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-primary/10 hover:text-primary transition-all" aria-label="تحميل">
                                 <Download className="h-4 w-4" />
                               </Button>
                               <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-all" onClick={() => handleDelete(post.id)} aria-label="حذف">
                                 <Trash2 className="h-4 w-4" />
                               </Button>
                            </div>
                         </TableCell>
                       </TableRow>
                     );
                   })}
                 </TableBody>
               </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
