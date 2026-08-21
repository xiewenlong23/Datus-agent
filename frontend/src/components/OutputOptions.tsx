import { useChatStore } from '../stores/chatStore'
import type { OutputOptionGroup } from '../stores/chatStore'

interface OutputOptionsProps {
  groups: OutputOptionGroup[]
}

export default function OutputOptions({ groups }: OutputOptionsProps) {
  const { outputOptions, setOutputOption } = useChatStore()

  return (
    <div className="output-options">
      {groups.map(group => (
        <div key={group.key} className="output-option-group">
          <span className="output-option-label">{group.label}</span>
          <div className="output-option-tags">
            {group.options.map(opt => (
              <button
                key={opt.value}
                className={`output-tag${outputOptions[group.key] === opt.value ? ' active' : ''}`}
                onClick={() => setOutputOption(group.key, opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}