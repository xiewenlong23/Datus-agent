import { useEffect, useState } from 'react'

interface TableInfo {
  table_name: string
  table_schema: string
  column_count: number
  row_count?: number
  last_analyzed?: string
  comment?: string
}

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_comment?: string
  character_maximum_length?: number
}

export default function DataExplorerPage() {
  const [databases, setDatabases] = useState<{ name: string; type: string; current: boolean }[]>([])
  const [tables, setTables] = useState<TableInfo[]>([])
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchDatabases()
  }, [])

  const fetchDatabases = async () => {
    try {
      const res = await fetch('/api/v1/catalog/list')
      const data = await res.json()
      const dbs: { name: string; type: string; current: boolean }[] = (data.data?.databases || []).map((d: any) => ({
        name: d.name,
        type: d.type,
        current: d.current,
      }))
      setDatabases(dbs)
      if (dbs.length > 0 && !selectedDb) {
        setSelectedDb(dbs.find(d => d.current)?.name || dbs[0].name)
      }
      setLoading(false)
    } catch (err) {
      console.error('Failed to fetch databases:', err)
      setLoading(false)
    }
  }

  const fetchTables = async (db: string) => {
    try {
      const res = await fetch(`/api/v1/database/tables?database=${encodeURIComponent(db)}`)
      const data = await res.json()
      setTables(data.data?.tables || [])
      setColumns([])
      setSelectedTable('')
    } catch (err) {
      console.error('Failed to fetch tables:', err)
    }
  }

  const fetchColumns = async (table: string) => {
    try {
      const res = await fetch(`/api/v1/database/columns?table=${encodeURIComponent(table)}`)
      const data = await res.json()
      setColumns(data.data?.columns || [])
    } catch (err) {
      console.error('Failed to fetch columns:', err)
    }
  }

  const handleDbChange = (db: string) => {
    setSelectedDb(db)
    fetchTables(db)
  }

  const handleTableClick = (table: string) => {
    setSelectedTable(table)
    fetchColumns(table)
  }

  const filteredTables = tables.filter(t =>
    t.table_name.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  if (loading) {
    return (
      <div className="standalone-page">
        <p>数据加载中...</p>
      </div>
    )
  }

  return (
    <div className="explorer-page">
      <div className="explorer-header">
        <h1>数据探索</h1>
        <p>浏览数据库结构，查看表和字段信息</p>
      </div>

      <div className="explorer-content">
        {/* Database List */}
        <div className="explorer-sidebar">
          <h3 className="explorer-sidebar-title">数据源</h3>
          <div className="explorer-db-list">
            {databases.map(db => (
              <div
                key={db.name}
                className={`explorer-db-item${selectedDb === db.name ? ' active' : ''}`}
                onClick={() => handleDbChange(db.name)}
              >
                <span className="explorer-db-icon">{db.type === 'clickhouse' ? '🏔️' : '🗄️'}</span>
                <span className="explorer-db-name">{db.name}</span>
                {db.current && <span className="explorer-db-current">当前</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Table List */}
        <div className="explorer-tables">
          <div className="explorer-tables-header">
            <h3>表列表</h3>
            <input
              type="text"
              className="explorer-search"
              placeholder="搜索表..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="explorer-table-list">
            {filteredTables.map(table => (
              <div
                key={table.table_name}
                className={`explorer-table-item${selectedTable === table.table_name ? ' active' : ''}`}
                onClick={() => handleTableClick(table.table_name)}
              >
                <div className="explorer-table-info">
                  <span className="explorer-table-name">{table.table_name}</span>
                  <span className="explorer-table-meta">
                    {table.column_count} 字段 · {table.row_count ? `${table.row_count.toLocaleString()} 行` : '未知行数'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column Detail */}
        <div className="explorer-detail">
          <h3 className="explorer-detail-title">
            字段详情{selectedTable ? ` - ${selectedTable}` : ''}
          </h3>
          {columns.length === 0 ? (
            <div className="explorer-detail-empty">
              点击左侧表查看字段详情
            </div>
          ) : (
            <div className="explorer-columns-table">
              <table>
                <thead>
                  <tr>
                    <th>字段名</th>
                    <th>类型</th>
                    <th>长度</th>
                    <th>可空</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((col, i) => (
                    <tr key={i}>
                      <td className="explorer-col-name">{col.column_name}</td>
                      <td className="explorer-col-type">{col.data_type}</td>
                      <td>{col.character_maximum_length || '-'}</td>
                      <td>{col.is_nullable === 'YES' ? '是' : '否'}</td>
                      <td className="explorer-col-comment">{col.column_comment || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}