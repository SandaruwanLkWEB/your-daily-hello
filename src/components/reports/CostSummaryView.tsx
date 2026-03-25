import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PrintableReportLayout from './PrintableReportLayout';
import type { CostSummaryRow, ReportMeta } from '@/types/reports';

interface Props { data: CostSummaryRow[]; meta: ReportMeta }

function fmt(n: number) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(n);
}

export default function CostSummaryView({ data, meta }: Props) {
  const totalCost = data.reduce((s, r) => s + r.estimatedCost, 0);
  const totalDist = data.reduce((s, r) => s + r.estimatedDistanceKm, 0);
  const totalEmp = data.reduce((s, r) => s + r.employeeCount, 0);

  return (
    <PrintableReportLayout meta={{ ...meta, title: 'Cost Summary Report (Estimated)' }}>
      <div className="mb-4 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Note:</span> Costs are estimated using a flat rate per kilometre. These figures are indicative only and do not represent official operational costs.
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Route / Group</TableHead>
            <TableHead className="text-xs text-right">Distance (km)</TableHead>
            <TableHead className="text-xs text-right">Employees</TableHead>
            <TableHead className="text-xs text-right">Vehicle Cost</TableHead>
            <TableHead className="text-xs text-right">Est. Total</TableHead>
            <TableHead className="text-xs text-right">Per Employee</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs font-medium">{r.routeGroup}</TableCell>
              <TableCell className="text-xs text-right">{r.estimatedDistanceKm}</TableCell>
              <TableCell className="text-xs text-right">{r.employeeCount}</TableCell>
              <TableCell className="text-xs text-right">{fmt(r.vehicleCost)}</TableCell>
              <TableCell className="text-xs text-right font-semibold">{fmt(r.estimatedCost)}</TableCell>
              <TableCell className="text-xs text-right">{fmt(r.costPerEmployee)}</TableCell>
            </TableRow>
          ))}
          {/* Totals row */}
          <TableRow className="border-t-2 border-foreground/20">
            <TableCell className="text-xs font-bold">TOTAL</TableCell>
            <TableCell className="text-xs text-right font-bold">{totalDist}</TableCell>
            <TableCell className="text-xs text-right font-bold">{totalEmp}</TableCell>
            <TableCell className="text-xs text-right font-bold">{fmt(data.reduce((s, r) => s + r.vehicleCost, 0))}</TableCell>
            <TableCell className="text-xs text-right font-bold">{fmt(totalCost)}</TableCell>
            <TableCell className="text-xs text-right font-bold">{fmt(totalEmp > 0 ? totalCost / totalEmp : 0)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </PrintableReportLayout>
  );
}
