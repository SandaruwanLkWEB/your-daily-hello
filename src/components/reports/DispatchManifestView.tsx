import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PrintableReportLayout from './PrintableReportLayout';
import type { DispatchManifestRow, ReportMeta } from '@/types/reports';

interface Props { data: DispatchManifestRow[]; meta: ReportMeta }

export default function DispatchManifestView({ data, meta }: Props) {
  return (
    <PrintableReportLayout meta={{ ...meta, title: 'Final Dispatch Manifest' }}>
      {data.map((m, i) => (
        <div key={i} className="mb-8 print:break-inside-avoid">
          <div className="rounded-lg border border-border p-4 print:border print:border-gray-400 print:p-3">
            <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-foreground print:text-black">
                  Group: <span className="font-mono">{m.groupCode}</span>
                </h3>
                <p className="text-xs text-muted-foreground">Date: {m.requestDate}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-foreground print:text-black">Vehicle: <span className="font-mono">{m.vehicleReg}</span></p>
                <p className="text-xs text-muted-foreground">Driver: {m.driverName} · {m.driverPhone}</p>
              </div>
            </div>

            {m.notes && (
              <div className="mb-3 rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground print:bg-gray-100">
                <span className="font-semibold">Instructions: </span>{m.notes}
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-16">Drop #</TableHead>
                  <TableHead className="text-xs">Employee</TableHead>
                  <TableHead className="text-xs">Destination</TableHead>
                  <TableHead className="text-xs w-24 print:block hidden">Signature</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.employees.map((e, j) => (
                  <TableRow key={j}>
                    <TableCell className="text-xs font-semibold">{e.sequence}</TableCell>
                    <TableCell className="text-xs">{e.name}</TableCell>
                    <TableCell className="text-xs">{e.destination}</TableCell>
                    <TableCell className="text-xs print:block hidden">
                      <div className="border-b border-dashed border-gray-400 h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Print-only acknowledgement */}
            <div className="hidden print:block mt-6 pt-4 border-t border-gray-300">
              <div className="grid grid-cols-2 gap-8 text-[10px] text-gray-600">
                <div>
                  <p className="mb-6">Driver Signature: ___________________________</p>
                  <p>Date/Time: ___________________________</p>
                </div>
                <div>
                  <p className="mb-6">Supervisor Signature: ___________________________</p>
                  <p>Date/Time: ___________________________</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      <div className="mt-4 text-xs text-muted-foreground print:text-gray-500">
        Total groups: {data.length} · Total passengers: {data.reduce((s, m) => s + m.employees.length, 0)}
      </div>
    </PrintableReportLayout>
  );
}
