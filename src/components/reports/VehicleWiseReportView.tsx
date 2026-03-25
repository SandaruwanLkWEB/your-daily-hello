import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import PrintableReportLayout from './PrintableReportLayout';
import type { VehicleWiseRow, ReportMeta } from '@/types/reports';

interface Props { data: VehicleWiseRow[]; meta: ReportMeta }

export default function VehicleWiseReportView({ data, meta }: Props) {
  return (
    <PrintableReportLayout meta={{ ...meta, title: 'Vehicle-Wise Assignment Report' }}>
      {data.map((v, i) => (
        <div key={i} className="mb-6 rounded-lg border border-border p-4 print:border print:border-gray-300 print:p-3">
          <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-foreground print:text-black font-mono">{v.vehicleReg}</h3>
              <p className="text-xs text-muted-foreground">{v.vehicleType} · Driver: {v.driverName} · {v.driverPhone}</p>
            </div>
            <div className="flex items-center gap-2">
              {v.overflow && <Badge variant="destructive" className="text-[10px]">OVERFLOW</Badge>}
              <span className="text-xs font-semibold text-foreground">{v.occupancy}/{v.capacity}</span>
            </div>
          </div>
          <div className="mb-3">
            <Progress value={(v.occupancy / v.capacity) * 100} className="h-2" />
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {v.groupCodes.map(g => (
              <Badge key={g} variant="outline" className="text-[10px] font-mono">{g}</Badge>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead className="text-xs">#</TableHead><TableHead className="text-xs">Employee</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {v.employees.map((e, j) => (
                <TableRow key={j}>
                  <TableCell className="text-xs w-10">{j + 1}</TableCell>
                  <TableCell className="text-xs">{e}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      <div className="mt-4 text-xs text-muted-foreground print:text-gray-500">
        Total vehicles: {data.length} · Total passengers: {data.reduce((s, v) => s + v.occupancy, 0)}
      </div>
    </PrintableReportLayout>
  );
}
