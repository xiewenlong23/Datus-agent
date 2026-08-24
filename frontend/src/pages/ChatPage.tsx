import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Toolbar from '../components/Toolbar'
import TaskPanel from '../components/TaskPanel'
import ChatArea from '../components/ChatArea'
import { useChatStore } from '../stores/chatStore'
import type { TaskTemplate } from '../stores/chatStore'
import { fetchTemplates } from '../services/templates'
import { getChatHistory } from '../services/sessions'

// Static task templates for initial rendering (P1)
// Will be replaced by API call in P2
const FALLBACK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'contract-review',
    name: '合同审查',
    description: '风险条款定位、后果说明与可替换条文',
    heading: '上传合同，或直接问我一个条款',
    subtitle: '标出风险条款、说明不改的后果，并给出可直接替换的条文。',
    inputPlaceholder: '想重点问什么？例如「这份采购合同里有哪些对我方不利的单方解除权」',
    fileUpload: true,
    outputOptions: [],
    quickActions: [],
  },
  {
    id: 'contract-writing',
    name: '合同编写',
    description: '按交易要素起草完整合同与备选条款',
    heading: '告诉我合同类型，我来起草',
    subtitle: '说明交易背景、双方角色和关键条款偏好，即可生成合同初稿。',
    inputPlaceholder: '例如「起草一份软件开发合同，我方是甲方，预算 50 万，周期 3 个月」',
    fileUpload: false,
    outputOptions: [],
    quickActions: [],
  },
  {
    id: 'data-analysis',
    name: '数据分析',
    description: '清洗建模、可视化与结论撰写',
    heading: '告别繁琐，让数据自己说话',
    subtitle: '上传表格或关联数据源，我来做清洗、建模、可视化，并写出结论。',
    inputPlaceholder: '分析 2025 年中国新能源汽车销量数据，识别主要品牌市场份额及用户偏好，预测未来市场走向。',
    fileUpload: true,
    outputOptions: [
      { key: 'depth', label: '分析深度', options: [{ value: 'standard', label: '标准' }, { value: 'deep', label: '深度' }, { value: 'concise', label: '简洁' }] },
      { key: 'format', label: '输出格式', options: [{ value: 'markdown', label: '文本（Markdown）' }, { value: 'table_chart', label: '表格 + 图表' }, { value: 'report', label: '完整报告' }] },
    ],
    quickActions: [
      { title: '销售趋势与同环比拆解', tags: ['6 张图表'], description: '按月拆解同比环比，定位增长与下滑来源', prompt: '按月份拆解近12个月的销售趋势，计算同比和环比变化，定位增长和下滑的来源' },
      { title: '商品转化漏斗诊断', tags: ['电商'], description: '找出高点击低转化商品，给出改进优先级', prompt: '分析商品转化漏斗，找出高点击低转化的商品，给出改进优先级' },
      { title: '客户分群与复购预测', tags: ['建模'], description: 'RFM 分群，预测各群体 90 天复购概率', prompt: '用RFM模型对客户分群，预测各群体未来90天的复购概率' },
      { title: '门店 GMV 异常归因', tags: ['归因'], description: '逐层拆到品类、客流与客单价，定位主因', prompt: '对门店GMV异常进行归因分析，逐层拆解到品类、客流和客单价层面' },
    ],
  },
  {
    id: 'db-query',
    name: '数据库问数',
    description: '关联数据库，用自然语言查询并出报告',
    heading: '关联数据库，把问题直接问出来',
    subtitle: '不用写 SQL，选好库表就能查数、做分析，并产出带洞察与建议的报告。',
    inputPlaceholder: '描述你想查什么或分析什么。例如「统计近 12 个月各品类的销售额与同比变化，并输出一份分析报告」',
    fileUpload: false,
    outputOptions: [
      { key: 'depth', label: '分析深度', options: [{ value: 'standard', label: '标准' }, { value: 'deep', label: '深度' }, { value: 'concise', label: '简洁' }] },
      { key: 'format', label: '输出格式', options: [{ value: 'markdown', label: '文本（Markdown）' }, { value: 'table_chart', label: '表格 + 图表' }, { value: 'report', label: '完整报告' }] },
    ],
    quickActions: [
      { title: '经营大盘与同比拆解', tags: ['出报告'], description: '按月汇总核心指标，拆到品类与渠道并给出结论', prompt: '统计近12个月各品类的销售额与同比变化，并输出一份分析报告' },
      { title: '销量 TOP 商品明细', tags: ['即问即答'], description: '一句话查询，直接返回结果表并导出 CSV', prompt: '查询销量前10的商品及销售额' },
      { title: '客户留存与流失诊断', tags: ['含建议'], description: '按注册月分群算留存，定位流失环节与原因', prompt: '分析客户留存情况，按注册月分群，定位流失环节与原因' },
      { title: '异常订单排查', tags: ['归因'], description: '定位异常记录，逐层下钻到时间、渠道与商品', prompt: '排查最近30天的异常订单，按时间、渠道、商品维度定位原因' },
    ],
  },
  {
    id: 'data-collection',
    name: '数据采集',
    description: '网页数据结构化，翻页与登录态托管',
    heading: '输入网址，自动采集结构化数据',
    subtitle: '支持翻页、登录态托管、定时采集，数据直接入库或导出为 CSV/Excel。',
    inputPlaceholder: '粘贴目标网页 URL，或描述你想采集什么数据',
    fileUpload: false,
    outputOptions: [],
    quickActions: [],
  },
]

export default function ChatPage() {
  const [searchParams] = useSearchParams()
  const { currentTaskType, setCurrentTaskType, setSessionId, setTemplates, setMessages, templates } = useChatStore()
  const [showTaskPanel, setShowTaskPanel] = useState(true)

  // Initialize from URL params or default
  useEffect(() => {
    const taskFromUrl = searchParams.get('task')
    if (taskFromUrl) {
      setCurrentTaskType(taskFromUrl)
    } else if (!currentTaskType) {
      setCurrentTaskType('data-analysis')
    }
    // Load templates from backend API (P2); keep fallback if API not available
    setTemplates(FALLBACK_TEMPLATES)
    fetchTemplates().then(remote => {
      if (remote.length > 0) setTemplates(remote)
    }).catch(() => {
      // Silently keep fallback templates
    })

    // Load session history from URL param (P3)
    const sessionFromUrl = searchParams.get('session')
    if (sessionFromUrl) {
      setSessionId(sessionFromUrl)
      getChatHistory(sessionFromUrl).then(history => {
        if (history.length > 0) {
          setMessages(history)
        }
      }).catch(() => {
        // Silently fail
      })
    }
  }, [])

  const currentTemplate = templates.find(t => t.id === currentTaskType)

  return (
    <div className="chat-page">
      <Toolbar />
      <div className="chat-page-body">
        <TaskPanel
          templates={templates}
          currentTaskType={currentTaskType}
          onSelect={setCurrentTaskType}
          collapsed={!showTaskPanel}
          onToggle={() => setShowTaskPanel(!showTaskPanel)}
        />
        <ChatArea template={currentTemplate} />
      </div>
    </div>
  )
}