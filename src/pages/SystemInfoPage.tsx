import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Bus, Code2, Database, Globe, Layers, Monitor, Server,
  Shield, Sparkles, Heart, Coffee,
} from 'lucide-react';

export default function SystemInfoPage() {
  const techStack = [
    { label: 'Frontend', value: 'React 18 + TypeScript', icon: Monitor },
    { label: 'UI Framework', value: 'Tailwind CSS + shadcn/ui', icon: Layers },
    { label: 'Backend', value: 'NestJS + TypeORM', icon: Server },
    { label: 'Database', value: 'PostgreSQL', icon: Database },
    { label: 'Authentication', value: 'JWT + TOTP 2FA', icon: Shield },
    { label: 'Internationalization', value: 'English • සිංහල • தமிழ்', icon: Globe },
  ];

  const systemModules = [
    'Employee Management',
    'Transport Request Workflow',
    'Route & Grouping Optimization',
    'Vehicle & Driver Management',
    'Multi-Level Approval System',
    'Department Management',
    'Real-time Notifications',
    'Comprehensive Reporting',
    'Audit Trail & Compliance',
    'Analytics Dashboard',
    'Self-Service Portal',
    'Bulk Data Import/Export',
  ];

  const roles = [
    { role: 'Super Admin', code: 'SUPER_ADMIN', desc: 'Full system access with bypass privileges' },
    { role: 'Admin', code: 'ADMIN', desc: 'Operational management and approvals' },
    { role: 'HOD', code: 'HOD', desc: 'Department head - manages department requests' },
    { role: 'HR', code: 'HR', desc: 'Human resources - final approvals and employee records' },
    { role: 'Transport Authority', code: 'TRANSPORT_AUTHORITY', desc: 'Route assignment, grouping, and dispatch' },
    { role: 'Planning', code: 'PLANNING', desc: 'Vehicle and resource planning oversight' },
    { role: 'Employee', code: 'EMP', desc: 'Self-service access, transport view, and profile' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">System Information</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Technical overview and system details
        </p>
      </div>

      {/* Hero Card */}
      <Card className="overflow-hidden">
        <div className="relative p-6" style={{ background: 'var(--gradient-primary)' }}>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <Bus className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Production Transport Control System</h2>
              <p className="text-white/80 text-sm mt-0.5">
                Intelligent Employee Transport Management Platform
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">v1.0.0</Badge>
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">Production</Badge>
          </div>
        </div>
      </Card>

      {/* Tech Stack */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="h-4 w-4 text-primary" />
            Technology Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {techStack.map((tech, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                <div className="p-2 rounded-md bg-primary/10">
                  <tech.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{tech.label}</p>
                  <p className="text-sm font-medium text-foreground">{tech.value}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Modules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            System Modules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {systemModules.map((mod, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <span className="text-foreground">{mod}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            User Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {roles.map((r, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">{r.code}</Badge>
                <div>
                  <p className="text-sm font-medium text-foreground">{r.role}</p>
                  <p className="text-xs text-muted-foreground">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer - Credits */}
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="p-6">
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
              <span className="text-xs">Crafted with</span>
              <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
              <span className="text-xs">and</span>
              <Coffee className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <Separator className="max-w-xs mx-auto" />
            <div>
              <p className="text-sm font-semibold text-foreground">W.O Sandaruwan Jayalath</p>
              <p className="text-xs text-muted-foreground mt-0.5">Production Transport Control Unit</p>
            </div>
            <p className="text-[11px] text-muted-foreground/60 max-w-md mx-auto">
              Designed and developed to streamline employee transport operations — 
              because every journey home matters.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
