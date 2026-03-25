import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PrintableReportLayout from './PrintableReportLayout';
import type { RouteWiseRow, ReportMeta } from '@/types/reports';

interface Props { data: RouteWiseRow[]; meta: ReportMeta }

export default function RouteWiseReportView({ data, meta }: Props) {
  const grouped = data.reduce<Record<string, RouteWiseRow[]>>((acc, r) => {
    (acc[r.routeName] = acc[r.routeName] || []).push(r);
    return acc;
  }, {});

  return (
    <PrintableReportLayout meta={{ ...meta, title: 'Route-Wise Drop-Off Report' }}>
      {Object.entries(grouped).map(([route, rows]) => (
        <div key={route} className="mb-6">
          <h3 className="text-sm font-bold text-foreground mb-2 print:text-black">{route}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Employee</TableHead>
                <TableHead className="text-xs">Destination</TableHead>
                <TableHead className="text-xs">Vehicle</TableHead>
                <TableHead className="text-xs">Driver</TableHead>
                <TableHead className="text-xs">Phone</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">{r.groupCode}</TableCell>
                  <TableCell className="text-xs">{r.employeeName}</TableCell>
                  <TableCell className="text-xs">{r.destination}</TableCell>
                  <TableCell className="text-xs font-mono">{r.vehicleReg}</TableCell>
                  <TableCell className="text-xs">{r.driverName}</TableCell>
                  <TableCell className="text-xs">{r.driverPhone}</TableCell>
                  <TableCell className="text-xs">
                    <span className="rounded-full bg-[hsl(var(--success))]/10 px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--success))]">{r.status}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      <div className="mt-4 text-xs text-muted-foreground print:text-gray-500">
        Total employees: {data.length} · Routes: {Object.keys(grouped).length}
      </div>
    </PrintableReportLayout>
  );
}
