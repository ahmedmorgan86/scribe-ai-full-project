import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Sparkles, 
  Library as LibraryIcon, 
  Settings, 
  Menu, 
  X,
  ChevronRight,
  ChevronLeft,
  Bell,
  Search,
  User,
  Zap,
  Globe,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Separator } from './components/ui/separator';
import { Badge } from './components/ui/badge';
import { Dashboard } from './features/Dashboard';
import { CreativeStudio } from './features/CreativeStudio';
import { Library } from './features/Library';

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    console.log("RENDER_SUCCESS_DIFFERENTIATED");
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, breadcrumb: 'الرئيسية / لوحة التحكم' },
    { id: 'studio', label: 'استوديو الإبداع', icon: Sparkles, badge: 'جديد', breadcrumb: 'الرئيسية / استوديو الإبداع' },
    { id: 'library', label: 'المكتبة', icon: LibraryIcon, breadcrumb: 'الرئيسية / المكتبة' },
    { id: 'settings', label: 'الإعدادات', icon: Settings, breadcrumb: 'الرئيسية / الإعدادات' },
  ];

  const currentNav = navItems.find(item => item.id === activeView) || navItems[0];

  // Dynamic mesh color based on active view
  const getMeshColor = () => {
    switch (activeView) {
      case 'dashboard': return 'from-violet-500/20 via-primary/5 to-transparent';
      case 'studio': return 'from-blue-500/20 via-purple-500/10 to-transparent';
      case 'library': return 'from-slate-500/20 via-slate-400/5 to-transparent';
      default: return 'from-primary/10 via-transparent to-transparent';
    }
  };

  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard': return <Dashboard />;
      case 'studio': return <CreativeStudio onComplete={() => console.log("[ACTION_START] Studio Completion")} />;
      case 'library': return <Library />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden selection:bg-primary/30 font-sans" dir="rtl" style={{ fontFamily: "'Readex Pro', sans-serif" }}>
      {/* Dynamic Background Mesh wash */}
      <div className={cn("fixed inset-0 bg-gradient-to-tr transition-all duration-1000 pointer-events-none z-0 opacity-40", getMeshColor())} />
      <div className="fixed inset-0 bg-[url('./assets/texture-noise.jpg')] bg-repeat opacity-[0.03] pointer-events-none z-0" />

      {/* Desktop Sidebar */}
      <aside 
        className={cn(
          "hidden lg:flex flex-col bg-card/40 backdrop-blur-2xl border-l border-primary/10 transition-all duration-500 ease-in-out relative z-30 shadow-2xl",
          isSidebarOpen ? "w-72" : "w-24"
        )}
      >
        <div className="p-8 flex items-center gap-4">
          <div className="h-12 w-12 shrink-0 rounded-2xl bg-primary flex items-center justify-center shadow-xl shadow-primary/20 rotate-3 group-hover:rotate-0 transition-transform">
            <Zap className="h-7 w-7 text-primary-foreground fill-current" />
          </div>
          {isSidebarOpen && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-700">
              <h1 className="text-2xl font-black font-heading tracking-tighter leading-none">سكرايب AI</h1>
              <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest leading-none mt-1.5 opacity-60">Creative Engine</p>
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 group relative overflow-hidden active:scale-95",
                activeView === item.id 
                  ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20" 
                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
              )}
            >
              <item.icon className={cn("h-6 w-6 shrink-0", activeView === item.id ? "scale-110" : "group-hover:scale-110 transition-transform")} />
              {isSidebarOpen && (
                <div className="flex-1 flex items-center justify-between animate-in fade-in slide-in-from-right-4 duration-500">
                  <span className="font-bold text-sm tracking-tight">{item.label}</span>
                  {item.badge && (
                    <Badge variant="outline" className="text-[9px] px-2 py-0.5 bg-primary-foreground/15 text-primary-foreground border-transparent font-black uppercase tracking-wider">
                      {item.badge}
                    </Badge>
                  )}
                </div>
              )}
              {activeView === item.id && (
                <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-primary-foreground/40 rounded-l-full" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-6 mt-auto space-y-6">
          {isSidebarOpen && (
            <Card className="p-5 rounded-3xl bg-gradient-to-br from-primary/10 to-violet-500/10 border border-primary/10 space-y-4 shadow-inner relative overflow-hidden group">
              <div className="absolute -top-10 -left-10 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-1000" />
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
                <span className="text-xs font-black text-primary uppercase tracking-widest">PRO PLAN</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] font-black uppercase tracking-tighter">
                  <span className="opacity-60">AI Credits</span>
                  <span className="text-primary font-black">74%</span>
                </div>
                <div className="h-2 w-full bg-primary/10 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary),0.5)] transition-all duration-1000" style={{ width: '74%' }} />
                </div>
              </div>
              <Button size="sm" className="w-full text-[11px] h-9 font-black rounded-xl shadow-lg shadow-primary/10 hover:shadow-primary/20 transition-all">ترقية الآن</Button>
            </Card>
          )}
          
          <Separator className="bg-primary/10" />
          
          <div className={cn("flex items-center gap-4 p-2 group cursor-pointer", isSidebarOpen ? "justify-start" : "justify-center")}>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-primary to-violet-500 p-0.5 shadow-2xl shadow-primary/20 rotate-3 group-hover:rotate-0 transition-all duration-500">
              <div className="h-full w-full rounded-2xl bg-background flex items-center justify-center overflow-hidden">
                <User className="h-7 w-7 text-primary group-hover:scale-110 transition-transform" />
              </div>
            </div>
            {isSidebarOpen && (
              <div className="animate-in fade-in duration-500 overflow-hidden">
                <div className="text-base font-black truncate tracking-tighter">أحمد مرجان</div>
                <div className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-60">Super Creator</div>
              </div>
            )}
          </div>
        </div>

        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-4 top-1/2 -translate-y-1/2 h-8 w-8 rounded-xl border border-primary/10 bg-background shadow-2xl flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all z-40 group active:scale-90"
        >
          {isSidebarOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden z-10">
        {/* Header */}
        <header className="h-20 flex items-center justify-between px-6 lg:px-12 border-b border-primary/5 glass-heavy relative z-20 shadow-sm">
          <div className="flex items-center gap-4 lg:hidden">
            <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(true)} className="rounded-xl h-11 w-11 hover:bg-primary/5">
              <Menu className="h-6 w-6" />
            </Button>
            <h1 className="text-xl font-black font-heading tracking-tighter leading-none">سكرايب AI</h1>
          </div>

          <div className="hidden lg:flex flex-col">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1">
               <Globe className="h-3 w-3" />
               <span>{currentNav.breadcrumb}</span>
            </div>
            <h2 className="text-xl font-black font-heading tracking-tight">{currentNav.label}</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 bg-primary/5 border border-primary/5 rounded-2xl px-4 py-2 text-sm font-black transition-all hover:bg-primary/10 cursor-pointer shadow-inner group">
               <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
               <span className="text-[10px] text-muted-foreground tracking-widest uppercase group-hover:text-primary transition-colors">AI Status: Online</span>
            </div>
            <Separator orientation="vertical" className="h-8 mx-2 bg-primary/10 hidden sm:block" />
            <Button variant="ghost" size="icon" className="relative group h-11 w-11 rounded-xl hover:bg-primary/5">
              <Bell className="h-6 w-6 group-hover:text-primary transition-colors" />
              <div className="absolute top-3 left-3 h-2.5 w-2.5 bg-primary rounded-full border-2 border-background shadow-[0_0_5px_rgba(var(--primary),0.8)]" />
            </Button>
            <Button className="h-11 rounded-xl px-6 font-black gap-2 shadow-lg shadow-primary/20 group">
              <Plus className="h-4 w-4 group-hover:rotate-90 transition-transform" /> منشور جديد
            </Button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto relative scroll-smooth overflow-x-hidden">
          <div className="max-w-[1400px] mx-auto p-6 lg:p-12 pb-24 lg:pb-12 h-full">
            {renderActiveView()}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-18 bg-background/80 backdrop-blur-2xl border-t border-primary/10 flex items-center justify-around px-6 z-40 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={cn(
              "flex flex-col items-center gap-1.5 transition-all duration-300 p-2 rounded-2xl",
              activeView === item.id ? "text-primary scale-110 -translate-y-2" : "text-muted-foreground opacity-60"
            )}
          >
            <div className={cn("p-2.5 rounded-2xl transition-all", activeView === item.id && "bg-primary text-primary-foreground shadow-xl shadow-primary/20")}>
              <item.icon className="h-6 w-6" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-0 z-[100] bg-background/98 backdrop-blur-3xl flex flex-col"
          >
            <div className="p-8 flex items-center justify-between border-b border-primary/10">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center shadow-xl shadow-primary/20">
                  <Zap className="h-7 w-7 text-primary-foreground fill-current" />
                </div>
                <h1 className="text-2xl font-black font-heading tracking-tighter">سكرايب AI</h1>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(false)} className="h-12 w-12 rounded-2xl hover:bg-primary/5">
                <X className="h-8 w-8" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-4">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setActiveView(item.id); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-6 text-3xl font-black py-6 px-8 rounded-3xl transition-all active:scale-95",
                    activeView === item.id ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20" : "text-muted-foreground/60 hover:text-primary"
                  )}
                >
                  <item.icon className="h-10 w-10" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="p-12 mt-auto">
               <Card className="p-8 rounded-[40px] bg-primary text-primary-foreground text-center space-y-6">
                  <h3 className="text-2xl font-black font-heading">جاهز للترقية؟</h3>
                  <p className="text-primary-foreground/70 font-bold">احصل على وصول غير محدود لجميع المميزات المتقدمة.</p>
                  <Button variant="secondary" className="w-full h-14 rounded-2xl text-lg font-black">جرب النسخة الاحترافية</Button>
               </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
