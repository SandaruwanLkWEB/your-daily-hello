import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Lock, KeyRound, Eye, Database, RefreshCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function DataProtectionPage() {
  const protectionMeasures = [
    {
      icon: Lock,
      title: 'Encryption at Rest & In Transit',
      status: 'active',
      description: 'All sensitive data is encrypted using industry-standard AES-256 encryption at rest, and all communications between client and server use TLS 1.2+ encryption.',
    },
    {
      icon: KeyRound,
      title: 'Authentication & Access Control',
      status: 'active',
      description: 'JWT-based authentication with secure password hashing (bcrypt). Role-based access control (RBAC) with 7 distinct roles ensures users only access data relevant to their function.',
    },
    {
      icon: Eye,
      title: 'Audit Trail & Monitoring',
      status: 'active',
      description: 'Every significant action is logged with user identity, timestamp, and action type. Audit logs cover CREATE, UPDATE, DELETE, LOGIN, APPROVE, REJECT, and more.',
    },
    {
      icon: ShieldCheck,
      title: 'Two-Factor Authentication (2FA)',
      status: 'active',
      description: 'Optional TOTP-based two-factor authentication available for all user accounts, providing an additional layer of security beyond passwords.',
    },
    {
      icon: Database,
      title: 'Data Segregation',
      status: 'active',
      description: 'Department-level data isolation ensures HODs and employees only see information within their organizational boundary. Cross-department access requires elevated privileges.',
    },
    {
      icon: RefreshCcw,
      title: 'Session Management',
      status: 'active',
      description: 'Secure token refresh mechanism with configurable session timeouts. Refresh tokens are hashed and stored securely, with automatic invalidation on logout.',
    },
  ];

  const complianceItems = [
    { label: 'Password Policy', detail: 'Minimum strength requirements enforced', met: true },
    { label: 'Role-Based Access', detail: '7 roles with principle of least privilege', met: true },
    { label: 'Audit Logging', detail: 'All critical operations tracked', met: true },
    { label: 'Data Encryption', detail: 'TLS in transit, encrypted at rest', met: true },
    { label: 'Input Validation', detail: 'Server-side validation on all endpoints', met: true },
    { label: 'Rate Limiting', detail: 'Throttle protection on authentication endpoints', met: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Protection</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Security measures and compliance standards protecting your data
        </p>
      </div>

      <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/50">
            <ShieldCheck className="h-5 w-5 text-green-700 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">All Protection Systems Active</p>
            <p className="text-xs text-green-700/80 dark:text-green-400/70 mt-0.5">
              All data protection measures are currently operational. Security compliance is continuously monitored.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {protectionMeasures.map((measure, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <measure.icon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  {measure.title}
                </CardTitle>
                <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950/30">
                  Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">{measure.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Compliance Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {complianceItems.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Report a Security Concern</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                If you identify any potential security vulnerabilities or data protection concerns, 
                please report them immediately to the system administrator or contact the Help Desk. 
                All reports are treated confidentially.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
