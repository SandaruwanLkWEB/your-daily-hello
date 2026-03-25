import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Eye, Lock, FileText, Users, Server } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();

  const sections = [
    {
      icon: Eye,
      title: 'Information We Collect',
      content: `This system collects the following employee information necessary for transport coordination:
        • Full name, employee number, email address, and phone number
        • Department affiliation and role designation
        • Pickup/drop-off location coordinates and place assignments
        • Transport request history and scheduling preferences
        • Login activity and session information for security purposes`,
    },
    {
      icon: FileText,
      title: 'How We Use Your Information',
      content: `Your personal data is used exclusively for:
        • Coordinating and optimizing employee transport services
        • Processing drop-off requests and route assignments
        • Generating operational reports for transport planning
        • Communicating transport schedules and notifications
        • Maintaining audit trails for accountability and compliance`,
    },
    {
      icon: Users,
      title: 'Data Sharing & Access',
      content: `Access to your information is strictly role-based:
        • Department Heads (HOD) can view employees within their department
        • Transport Authority staff access location data for route planning
        • HR personnel review transport approvals and employee records
        • Administrators manage system-wide operations with full audit logging
        • Your data is never shared with external third parties without consent`,
    },
    {
      icon: Lock,
      title: 'Data Retention',
      content: `Transport records are retained according to organizational policy:
        • Active transport requests are maintained throughout their lifecycle
        • Completed requests are archived after monthly close processes
        • Audit logs are retained for compliance and accountability purposes
        • Employee records are maintained while employment is active
        • You may request data review through the self-service portal`,
    },
    {
      icon: Server,
      title: 'Security Measures',
      content: `We implement industry-standard security practices:
        • All data transmissions are encrypted using TLS/SSL protocols
        • Passwords are securely hashed and never stored in plain text
        • Two-factor authentication (2FA) is available for enhanced security
        • Role-based access control (RBAC) ensures minimum privilege access
        • All system actions are logged in the audit trail for monitoring`,
    },
    {
      icon: Shield,
      title: 'Your Rights',
      content: `As a system user, you have the right to:
        • View your personal information through the Employee Profile page
        • Request location updates through the Self-Service portal
        • Receive notifications about your transport assignments
        • Contact the Help Desk for any data-related inquiries
        • Request data correction or clarification through proper channels`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How we collect, use, and protect your personal information
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5">
          <p className="text-sm text-foreground leading-relaxed">
            The <strong>Production Transport Control Unit</strong> is committed to protecting the privacy 
            and personal data of all employees using this transport management system. This policy outlines 
            our data handling practices in accordance with organizational data protection standards.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Last updated: March 2026 • Effective for all system users
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {sections.map((section, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10">
                  <section.icon className="h-4 w-4 text-primary" />
                </div>
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {section.content}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-muted/30">
        <CardContent className="p-5 text-center">
          <p className="text-xs text-muted-foreground">
            For questions about this privacy policy, please contact the Help Desk or your department administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
