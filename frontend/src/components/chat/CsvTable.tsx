import { useMemo } from 'react'

interface CsvTableProps {
  csv: string
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

const MAX_ROWS = 100

/** Renders a `csv` content block as a table. */
export default function CsvTable({ csv }: CsvTableProps) {
  const rows = useMemo(() => parseCsv(csv), [csv])
  if (rows.length === 0) return null

  const [header, ...body] = rows
  const truncated = body.length > MAX_ROWS
  const visible = truncated ? body.slice(0, MAX_ROWS) : body

  return (
    <div className="csv-table-wrap">
      <table className="csv-table">
        <thead>
          <tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {truncated && <div className="csv-table-more">仅显示前 {MAX_ROWS} 行，共 {body.length} 行</div>}
    </div>
  )
}
