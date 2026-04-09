import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  TrendingUp, 
  Users, 
  CheckCircle2, 
  MessageSquare, 
  Clock, 
  ArrowUpRight,
  MoreVertical,
  Calendar,
  Share2
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { rpcCall, invalidateCache } from '../api';
import { cn } from '../lib/utils';
import { SiInstagram, SiX, SiTiktok } from 'react-icons/si';
import { FaLinkedinIn } from 'react-icons/fa';

const PLATFORM_ICONS: Record<string, any> = {
  'Instagram': SiInstagram,
  'LinkedIn': FaLinkedinIn,
  'X (Twitter)': SiX,
  'TikTok': SiTiktok,
};

export function Dashboard() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await rpcCall({ func: 'get_posts', args: { limit: 100 } });
      setPosts(data || []);
    } catch (err) {
      console.error("Failed to load dashboard posts", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Invalidate cache on mount to ensure fresh data for dashboard stats
    invalidateCache(['get_posts']);
    loadPosts();
  }, [loadPosts]);

  const dynamicEngagementData = useMemo(() => {
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    
    // Initialize map with 0s
    const dataMap = days.reduce((acc, day) => ({ ...acc, [day]: { sum: 0, count: 0 } }), {} as any);

    posts.forEach(post => {
      const date = new Date(post.created_at);
      const dayName = days[date.getDay()];
      const score = post.scores?.engagement || 0;
      
      if (dataMap[dayName]) {
        dataMap[dayName].sum += score;
        dataMap[dayName].count += 1;
      }
    });

    // Transform to Recharts format (average engagement per day)
    return days.map(day => ({
      name: day,
      value: dataMap[day].count > 0 ? Math.round(dataMap[day].sum / dataMap[day].count) : 0
    }));
  }, [posts]);

  const stats = useMemo(() => {
    const totalPosts = posts.length;
    const avgEngagement = totalPosts > 0 
      ? (posts.reduce((acc, post) => acc + (post.scores?.engagement || 0), 0) / totalPosts).toFixed(1)
      : '0';
    
    const scheduledPosts = posts.filter(p => p.status !== 'published').length;
    
    // Find top platform
    const platformCounts: Record<string, number> = {};
    posts.forEach(p => {
      platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
    });
    let topPlatform = '-';
    let maxCount = 0;
    for (const [platform, count] of Object.entries(platformCounts)) {
      if (count > maxCount) {
        maxCount = count;
        topPlatform = platform;
      }
    }

    return [
      { label: 'إجمالي المنشورات', value: totalPosts, icon: MessageSquare, delta: 0 },
      { label: 'معدل التفاعل', value: totalPosts > 0 ? `${avgEngagement}%` : '-', icon: TrendingUp, delta: 0 },
      { label: 'المنشورات المجدولة', value: scheduledPosts, icon: Clock, delta: 0 },
      { label: 'أفضل منصة', value: topPlatform, icon: Share2, delta: 0 },
    ];
  }, [posts]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700" dir="rtl">
      {/* Hero Header */}
      <div className="relative rounded-2xl overflow-hidden h-[200px] md:h-[260px] bg-cover bg-center shadow-2xl shadow-primary/10"
        style={{ backgroundImage: "url('./assets/hero-workspace-1.jpg')" }}>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="relative h-full flex flex-col justify-end p-6 md:p-10">
          <Badge className="w-fit mb-3 bg-primary/20 backdrop-blur-md text-primary border-primary/20">نظرة عامة على الأداء</Badge>
          <h1 className="font-heading text-3xl md:text-4xl font-black text-white tracking-tight">مرحباً بك مجدداً</h1>
          <p className="text-white/70 md:text-lg max-w-2xl mt-2">إليك نظرة سريعة على أداء محتواك الأخير. استمر في الإبداع!</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Card key={i} className="glass hover:shadow-card-hover transition-all duration-300 border-primary/5">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="rounded-xl bg-primary/10 p-2.5">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
                {stat.delta !== 0 && (
                  <Badge variant={stat.delta > 0 ? "default" : "destructive"} className="text-[10px] h-5 px-1.5 bg-emerald-500/10 text-emerald-500 border-transparent">
                    {stat.delta > 0 ? "+" : ""}{stat.delta}%
                  </Badge>
                )}
              </div>
              <div className="mt-4">
                <div className="text-2xl font-black font-heading tracking-tight">{stat.value}</div>
                <div className="text-xs font-bold text-muted-foreground mt-1 uppercase tracking-wider">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Engagement Chart */}
        <Card className="lg:col-span-8 glass border-primary/5 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-heading text-lg">اتجاهات التفاعل</CardTitle>
                <CardDescription>تحليل التفاعل اليومي عبر جميع المنصات</CardDescription>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-[11px] font-bold border-primary/10">آخر ٧ أيام</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <div className="h-[280px] w-full pr-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dynamicEngagementData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--primary)/0.05)" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fontWeight: 700, fill: 'hsl(var(--muted-foreground))' }} 
                  />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))', 
                      borderColor: 'hsl(var(--primary)/0.2)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity Timeline */}
        <Card className="lg:col-span-4 glass border-primary/5">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="font-heading text-lg">أحدث النشاطات</CardTitle>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-primary hover:bg-primary/5">مشاهدة الكل</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-0">
              {posts.map((post, i) => {
                const Icon = PLATFORM_ICONS[post.platform] || MessageSquare;
                return (
                  <div key={post.id} className={cn(
                    "flex items-start gap-4 p-4 transition-colors hover:bg-primary/5 relative group",
                    i !== posts.length - 1 && "border-b border-primary/5"
                  )}>
                    <div className="flex flex-col items-center relative z-10">
                      <div className="rounded-full p-2 bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-lg shadow-primary/5">
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{post.platform}</span>
                        <span className="text-[10px] font-bold text-muted-foreground">{new Date(post.created_at).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{post.original_prompt}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <Badge variant="outline" className="text-[9px] py-0 border-primary/10 bg-primary/5">{post.status === 'published' ? 'منشور' : 'مسودة'}</Badge>
                        <div className="flex items-center gap-1 text-[9px] font-bold text-violet-400">
                          <TrendingUp className="h-2 w-2" />
                          <span>{post.scores?.engagement}% تفاعل</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {posts.length === 0 && !loading && (
                <div className="p-10 text-center text-muted-foreground italic text-sm">
                  لا يوجد نشاطات مسجلة بعد.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
