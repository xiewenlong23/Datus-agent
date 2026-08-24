import type { TaskTemplate } from '../stores/chatStore'

interface TaskPanelProps {
  templates: TaskTemplate[]
  currentTaskType: string | null
  onSelect: (type: string) => void
  collapsed: boolean
  onToggle: () => void
}

const TASK_ICONS: Record<string, string> = {
  'data-analysis': '📊',
  'db-query': '🗄️',
  'data-collection': '🕷️',
}

export default function TaskPanel({
  templates,
  currentTaskType,
  onSelect,
  collapsed,
  onToggle,
}: TaskPanelProps) {
  return (
    <aside className={`task-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="task-panel-header">你想做什么？</div>
      {templates.map(tpl => (
        <div
          key={tpl.id}
          className={`task-item${tpl.id === currentTaskType ? ' active' : ''}`}
          onClick={() => onSelect(tpl.id)}
          title={tpl.name}
        >
          <div className="task-item-icon">{TASK_ICONS[tpl.id] || '📋'}</div>
          {!collapsed && (
            <div className="task-item-info">
              <div className="task-item-name">{tpl.name}</div>
              <div className="task-item-desc">{tpl.description}</div>
            </div>
          )}
        </div>
      ))}

      <button className="task-toggle" onClick={onToggle} title={collapsed ? '展开' : '收起'}>
        {collapsed ? '»' : '«'}
      </button>
    </aside>
  )
}