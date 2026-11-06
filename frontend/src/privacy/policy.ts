import type { Locale } from '../i18n'

export const PRIVACY_EMAIL = 'privacy@grailab.top'
export const PRIVACY_UPDATED = '2026-11-06'
export const PRIVACY_URL = 'https://grailab.top/privacy'

export type PolicyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'note'; title: string; text: string }
  | { kind: 'links'; items: { label: string; href: string }[] }

export interface PolicySection {
  id: string
  number: string
  title: string
  blocks: PolicyBlock[]
}

export interface PolicyCopy {
  nav: { home: string; articles: string; privacy: string; label: string }
  title: string
  lead: string
  meta: { updated: string; website: string; controller: string; contact: string }
  updatedDisplay: string
  summaryTitle: string
  summary: { label: string; text: string }[]
  tocTitle: string
  tocAria: string
  backToTop: string
  tableScroll: string
  tableHint: string
  sections: PolicySection[]
  end: { line: string; action: string }
  footer: { home: string; articles: string; privacy: string; contact: string; disclaimer: string }
  metaTitle: string
  metaDescription: string
}

const zhSections: PolicySection[] = [
  {
    id: 'controller',
    number: '01',
    title: '数据控制者与联系方式',
    blocks: [
      { kind: 'p', text: 'grailab.top 与其行情回放训练工作台由 grailab（以下称“我们”）运营。我们决定本政策所述个人信息的处理目的与方式。' },
      { kind: 'list', items: [
        '运营方：grailab',
        '隐私与数据请求：privacy@grailab.top',
        '一般支持：同一邮箱，请在主题中注明“支持”',
        '通信地址：如需邮寄，请先通过邮件联系我们获取当前地址',
      ] },
      { kind: 'p', text: '我们未设立强制要求的数据保护官。隐私事务由指定负责人处理，你可以通过上述邮箱直接联系到该负责人。' },
    ],
  },
  {
    id: 'what-we-collect',
    number: '02',
    title: '我们收集哪些信息',
    blocks: [
      { kind: 'h3', text: '2.1 你主动提供的信息' },
      { kind: 'list', items: [
        '账户信息：通过 Clerk 登录时使用的邮箱地址、姓名与头像；使用 Google 登录时，还包括 Google 账户提供的基本资料；以及用于区分账户的 Clerk 用户 ID。',
        '订阅与支付信息：订阅计划、订单号与支付状态。银行卡号、有效期与安全码由 Waffo Pancake 及其支付通道直接处理，不会经过、也不会保存在我们的服务器上。',
        '沟通记录：你发送给我们的邮件内容，以及你为解决问题而主动提供的其他信息。',
      ] },
      { kind: 'h3', text: '2.2 使用服务时产生的信息' },
      { kind: 'list', items: [
        '训练项目：品种、K 线周期、历史区间、复盘游标位置与项目名称。',
        '模拟交易记录：买卖方向、数量、成交时间与价格、单笔序号与盈亏结果。',
        '绘图与指标设置：趋势线、标注与 Stoch 副图可见性。',
        '偏好设置：界面语言、K 线颜色、快捷键与工作台视图。',
      ] },
      { kind: 'h3', text: '2.3 自动收集的信息' },
      { kind: 'list', items: [
        '访问日志：IP 地址、浏览器标识（User-Agent）、请求时间与请求路径，用于安全、排障与容量分析。',
        '登录会话：Clerk 设置的会话 Cookie，用于在你浏览时保持登录状态。',
        '防机器人信号：登录与注册时经 Clerk 启用的 Cloudflare Turnstile 可能收集区分自动化流量所需的浏览器信号。',
      ] },
      { kind: 'h3', text: '2.4 我们不收集的信息' },
      { kind: 'list', items: [
        '真实资金账户、券商或交易所凭据。',
        '身份证件、生物识别信息、精确位置或通讯录。',
        '银行卡数据：发卡行与卡号从不进入我们的系统。',
      ] },
      { kind: 'note', title: '训练数据存放在哪里', text: '训练项目、交易记录与绘图保存在我们的数据库，并按 Clerk 用户 ID 隔离。浏览器中的 localStorage 只作为离线缓存，同样按账户隔离；换一个账户登录，不会看到上一个账户的训练内容。' },
    ],
  },
  {
    id: 'how-we-use',
    number: '03',
    title: '我们如何使用这些信息',
    blocks: [
      { kind: 'p', text: '我们只在下列目的所需的范围内使用个人信息，每项用途都对应一项法律依据。' },
      { kind: 'table', head: ['用途', '具体说明', '法律依据'], rows: [
        ['提供训练服务', '载入历史行情、保存项目与交易记录、恢复绘图与偏好', '履行合同'],
        ['账户与登录', '通过 Clerk 验证身份，隔离不同账户的数据', '履行合同'],
        ['订阅与收款', '发起结账、核对支付结果、处理退款与订阅变更', '履行合同'],
        ['安全与防滥用', '访问日志、防机器人验证与异常请求排查', '合法利益'],
        ['客户支持', '回复你的问题与数据请求', '履行合同或合法利益'],
        ['服务通知', '订阅状态、支付结果、重大政策变更与安全提醒', '履行合同或法律义务'],
        ['法律合规', '满足税务、会计与监管留存要求', '法律义务'],
        ['产品改进', '基于汇总或去标识化的运营数据了解功能使用情况', '合法利益'],
      ] },
      { kind: 'p', text: '我们不会将你的训练项目、模拟交易记录或绘图用于训练人工智能模型，也不会将其出售或提供给广告商。' },
      { kind: 'p', text: '汇总或去标识化后无法识别到个人的数据，不再属于个人信息，我们可能用于统计与改进产品。' },
    ],
  },
  {
    id: 'cookies',
    number: '04',
    title: 'Cookie 与本地存储',
    blocks: [
      { kind: 'p', text: '我们只在维持服务所必需的地方使用浏览器存储，不使用广告 Cookie，也不做跨站追踪。' },
      { kind: 'table', head: ['类型', '来源', '作用', '能否关闭'], rows: [
        ['严格必要 Cookie', 'Clerk', '保持登录状态与会话安全', '不能，关闭后无法登录'],
        ['安全验证', 'Cloudflare Turnstile（经 Clerk 启用）', '区分自动化流量与真实用户', '不能'],
        ['本地存储（localStorage）', 'grailab', '界面语言、视图、K 线颜色、快捷键与项目离线缓存', '可以，清除浏览器数据即可'],
        ['支付会话', 'Waffo Pancake（其自有域名）', '完成结账与订阅管理', '由其收银台控制'],
      ] },
      { kind: 'p', text: '我们目前没有接入网站分析、广告或第三方追踪工具。若将来引入，会先更新本政策，并说明关闭方式。' },
    ],
  },
  {
    id: 'sharing',
    number: '05',
    title: '共享与披露',
    blocks: [
      { kind: 'p', text: '我们不出售、不出租你的个人信息，也不为跨站广告而共享。' },
      { kind: 'list', items: [
        '服务提供商：Clerk（身份认证）、Waffo Pancake（支付与订阅）、Cloudflare（域名解析与流量防护），以及提供云主机与数据库的服务商。他们只能按照我们的指示处理数据。',
        '法律要求：收到合法有效的法律程序、法院命令或监管要求时，我们会披露必要信息；法律允许时，会通知你。',
        '业务转移：合并、收购或资产转让时，个人信息可能作为资产的一部分转移。我们会要求接收方继续遵守本政策，并提前通知你。',
        '你的同意：除上述情形外，只有在取得你明确同意后才会共享。',
      ] },
      { kind: 'note', title: '银行卡数据', text: '由符合 PCI-DSS 的支付通道处理，不经过、也不存储于我们的服务器。我们只看到订单号、订阅状态与金额。' },
      { kind: 'links', items: [
        { label: 'Clerk 隐私政策', href: 'https://clerk.com/legal/privacy' },
        { label: 'Waffo 隐私政策', href: 'https://waffo.ai/privacy' },
        { label: 'Cloudflare 隐私政策', href: 'https://www.cloudflare.com/privacypolicy/' },
      ] },
    ],
  },
  {
    id: 'security',
    number: '06',
    title: '数据安全',
    blocks: [
      { kind: 'p', text: '我们采取与数据敏感程度相称的措施保护信息：' },
      { kind: 'list', items: [
        '全站通过 HTTPS 传输，并启用 HSTS，浏览器与服务器之间的通信全程加密。',
        '登录由 Clerk 托管，我们不接触也不保存你的密码。',
        '数据库按 Clerk 用户 ID 隔离；服务端凭据只保存在服务器环境变量中，前端不持有。',
        '按最小权限原则控制生产环境访问，并定期更新依赖与运行环境。',
      ] },
      { kind: 'p', text: '若发生影响你权益的数据泄露，我们会在确认后尽快通知你与监管机构。适用法律要求 72 小时内通知的，我们按该时限执行。' },
      { kind: 'p', text: '没有系统能保证绝对安全。请妥善保管登录邮箱与 Google 账户，并在发现异常时尽快联系我们。' },
    ],
  },
  {
    id: 'retention',
    number: '07',
    title: '保留期限',
    blocks: [
      { kind: 'p', text: '我们只在完成用途所需的期间内保留信息。' },
      { kind: 'table', head: ['数据类别', '保留期限', '到期处理'], rows: [
        ['账户信息（Clerk）', '账户存续期间', '注销后 30 天内删除'],
        ['训练项目、交易记录与绘图', '账户存续期间，你可以随时删除', '删除即时生效；注销后 30 天内清除'],
        ['支付与订阅事件记录', '按适用税务与会计义务的期限', '届满后删除或匿名化'],
        ['服务器访问日志', '一般不超过 30 天', '自动轮换覆盖'],
        ['客服邮件', '处理完毕后 24 个月内', '删除'],
        ['浏览器本地缓存', '保存在你的设备上', '直到你清除浏览器数据'],
      ] },
      { kind: 'p', text: '备份中的副本会在 90 天的轮换周期内被覆盖。法律要求继续保留的信息会从常规系统中隔离保存，不再用于其他目的。' },
    ],
  },
  {
    id: 'your-rights',
    number: '08',
    title: '你的数据权利',
    blocks: [
      { kind: 'p', text: '依据适用的数据保护法律（包括 GDPR、CCPA 与中国《个人信息保护法》），你可以行使以下权利：' },
      { kind: 'list', items: [
        '知情与访问：了解我们是否处理你的信息，并取得一份副本。',
        '更正：要求更正不准确的账户信息。',
        '删除：删除训练项目，或要求删除账户与相关数据。',
        '限制与反对：要求限制处理，或反对基于合法利益的处理。',
        '可携带：以结构化、通用的格式取得你提供的训练数据。',
        '撤回同意：对我们基于同意开展的处理，随时撤回同意。',
        '投诉：向你所在地的数据保护机构提出投诉。',
      ] },
      { kind: 'p', text: '行使方式：发送邮件至 privacy@grailab.top，并注明账户邮箱。为保护你的数据，我们可能需要先验证身份。我们会在收到请求后 30 天内回复。' },
      { kind: 'p', text: '你也可以直接在工作台删除训练项目；清除浏览器数据会同时删除本地缓存。删除不会影响删除前已经完成的处理。' },
    ],
  },
  {
    id: 'marketing',
    number: '09',
    title: '营销通信与退订',
    blocks: [
      { kind: 'p', text: '我们目前不发送营销邮件或短信。我们只会发送与服务直接相关的通知，例如订阅状态、支付结果、重大政策变更与安全提醒。' },
      { kind: 'p', text: '如果将来开展营销，我们会先取得你的同意，并在每封邮件中提供退订链接，同时在账户设置中提供开关。退订不影响账单、安全与其他必要的服务通知。' },
    ],
  },
  {
    id: 'transfers',
    number: '10',
    title: '跨境数据传输',
    blocks: [
      { kind: 'p', text: '我们使用的服务商可能位于你所在国家或地区以外，因此个人信息可能被传输到境外处理：' },
      { kind: 'list', items: [
        'Clerk：身份认证，主要位于美国。',
        'Waffo Pancake：支付与订阅管理。',
        'Cloudflare：域名解析与流量防护，在全球边缘节点处理请求。',
      ] },
      { kind: 'p', text: '跨境传输时，我们通过标准合同条款（SCC）、服务商的数据处理协议与传输加密提供保护，并要求接收方提供不低于本政策的保护水平。若适用法律要求单独同意或额外告知，我们会依该法律履行。' },
    ],
  },
  {
    id: 'minors',
    number: '11',
    title: '未成年人保护',
    blocks: [
      { kind: 'p', text: '服务面向 18 岁及以上的用户。我们不面向未成年人，也不会故意收集未满 18 岁者的个人信息。' },
      { kind: 'p', text: '若我们发现在未取得监护人同意的情况下收集了未满 18 岁者的信息，会尽快删除。家长或监护人可以通过 privacy@grailab.top 联系我们。' },
    ],
  },
  {
    id: 'third-parties',
    number: '12',
    title: '第三方链接与服务',
    blocks: [
      { kind: 'p', text: '本站包含指向第三方的链接，例如 Clerk 登录页、Google 登录、Waffo 收银台与文章中的外部链接。这些页面由第三方运营，本政策不适用于它们。' },
      { kind: 'p', text: '行情数据来自第三方数据源，其中只包含市场价格，不包含你的个人信息。在向第三方提供个人信息前，建议先查阅其隐私政策。' },
    ],
  },
  {
    id: 'changes',
    number: '13',
    title: '本政策的变更',
    blocks: [
      { kind: 'p', text: '我们可能更新本政策，以反映功能、服务商或法律要求的变化。' },
      { kind: 'p', text: '重大变更会在生效前至少 14 天通过站内公告或注册邮箱通知你；一般变更会在本页更新“最后更新”日期。变更生效后继续使用服务，视为你接受更新后的政策。' },
      { kind: 'p', text: '如果你不同意变更，可以停止使用服务并申请删除账户数据。历史版本可通过 privacy@grailab.top 索取。' },
    ],
  },
  {
    id: 'contact',
    number: '14',
    title: '联系我们',
    blocks: [
      { kind: 'p', text: '关于本政策、个人信息或数据请求，请通过以下方式联系我们：' },
      { kind: 'list', items: [
        '隐私与数据请求：privacy@grailab.top',
        '一般支持：privacy@grailab.top，主题注明“支持”',
        '运营方：grailab',
        '回复时间：工作日 5 个工作日内初步回复，权利请求在 30 天内完成',
      ] },
      { kind: 'p', text: '如果你对回复不满意，可以向所在地的数据保护机构投诉。我们欢迎你先联系我们，让问题有机会被直接解决。' },
    ],
  },
]

const enSections: PolicySection[] = [
  {
    id: 'controller',
    number: '01',
    title: 'Who is responsible for your data',
    blocks: [
      { kind: 'p', text: 'grailab.top and its historical replay workspace are operated by grailab (“we”, “us”). We decide why and how the personal information described here is processed.' },
      { kind: 'list', items: [
        'Operator: grailab',
        'Privacy and data requests: privacy@grailab.top',
        'General support: the same address, with “Support” in the subject line',
        'Postal address: email us first and we will provide the current address',
      ] },
      { kind: 'p', text: 'We are not required to appoint a data protection officer. A named person handles privacy matters and can be reached directly at the address above.' },
    ],
  },
  {
    id: 'what-we-collect',
    number: '02',
    title: 'What we collect',
    blocks: [
      { kind: 'h3', text: '2.1 Information you provide' },
      { kind: 'list', items: [
        'Account information: the email address, name and avatar used to sign in with Clerk; if you sign in with Google, the basic profile Google provides; and the Clerk user ID that identifies your account.',
        'Subscription and payment information: plan, order number and payment status. Card numbers, expiry dates and security codes are handled directly by Waffo Pancake and its payment channels. They never reach or sit on our servers.',
        'Correspondence: the content of emails you send us and anything else you choose to share when we help you with a problem.',
      ] },
      { kind: 'h3', text: '2.2 Information created while you practise' },
      { kind: 'list', items: [
        'Practice projects: symbol, timeframe, historical range, replay cursor position and project name.',
        'Simulated trades: side, size, execution time and price, sequence number, and profit or loss.',
        'Drawings and indicator settings: trend lines, annotations and Stoch visibility.',
        'Preferences: interface language, candle colours, keyboard shortcuts and workspace view.',
      ] },
      { kind: 'h3', text: '2.3 Information collected automatically' },
      { kind: 'list', items: [
        'Access logs: IP address, browser identifier (User-Agent), request time and path, used for security, troubleshooting and capacity planning.',
        'Session cookies set by Clerk to keep you signed in while you browse.',
        'Bot-protection signals: Cloudflare Turnstile, enabled through Clerk at sign-in and sign-up, may collect browser signals needed to tell automated traffic from people.',
      ] },
      { kind: 'h3', text: '2.4 What we do not collect' },
      { kind: 'list', items: [
        'Real-money accounts, brokerage or exchange credentials.',
        'Identity documents, biometric data, precise location or contacts.',
        'Card data: neither the card number nor the issuer ever enters our systems.',
      ] },
      { kind: 'note', title: 'Where your practice data lives', text: 'Projects, trades and drawings are stored in our database, scoped to your Clerk user ID. localStorage in the browser is only an offline cache, also scoped per account: signing in with another account never reveals the previous account’s practice data.' },
    ],
  },
  {
    id: 'how-we-use',
    number: '03',
    title: 'How we use your information',
    blocks: [
      { kind: 'p', text: 'We use personal information only as far as each purpose below requires, and each purpose has a legal basis.' },
      { kind: 'table', head: ['Purpose', 'What it covers', 'Legal basis'], rows: [
        ['Providing the training service', 'Loading historical data, saving projects and trades, restoring drawings and preferences', 'Performance of a contract'],
        ['Accounts and sign-in', 'Verifying identity through Clerk and isolating each account’s data', 'Performance of a contract'],
        ['Subscriptions and billing', 'Starting checkout, confirming payments, handling refunds and plan changes', 'Performance of a contract'],
        ['Security and abuse prevention', 'Access logs, bot protection and investigating unusual requests', 'Legitimate interests'],
        ['Customer support', 'Answering your questions and data requests', 'Contract or legitimate interests'],
        ['Service notices', 'Subscription and payment status, material policy changes, security alerts', 'Contract or legal obligation'],
        ['Legal compliance', 'Meeting tax, accounting and regulatory retention duties', 'Legal obligation'],
        ['Product improvement', 'Understanding feature usage from aggregated or de-identified operational data', 'Legitimate interests'],
      ] },
      { kind: 'p', text: 'We do not use your projects, simulated trades or drawings to train artificial intelligence models, and we do not sell them or provide them to advertisers.' },
      { kind: 'p', text: 'Once data is aggregated or de-identified so that it cannot be linked to a person, it is no longer personal information and may be used for statistics and product improvement.' },
    ],
  },
  {
    id: 'cookies',
    number: '04',
    title: 'Cookies and local storage',
    blocks: [
      { kind: 'p', text: 'We use browser storage only where the service needs it. We do not use advertising cookies or cross-site tracking.' },
      { kind: 'table', head: ['Type', 'Source', 'Purpose', 'Can you turn it off?'], rows: [
        ['Strictly necessary cookie', 'Clerk', 'Keeps you signed in and your session secure', 'No — sign-in cannot work without it'],
        ['Security check', 'Cloudflare Turnstile (via Clerk)', 'Distinguishes automated traffic from people', 'No'],
        ['Local storage (localStorage)', 'grailab', 'Language, view, candle colours, shortcuts and the project offline cache', 'Yes — clear your browser data'],
        ['Checkout session', 'Waffo Pancake (its own domain)', 'Completes checkout and manages your subscription', 'Controlled by its checkout'],
      ] },
      { kind: 'p', text: 'We currently use no analytics, advertising or third-party tracking tools. If that changes, we will update this policy first and explain how to opt out.' },
    ],
  },
  {
    id: 'sharing',
    number: '05',
    title: 'Sharing and disclosure',
    blocks: [
      { kind: 'p', text: 'We do not sell, rent or share your personal information for cross-site advertising.' },
      { kind: 'list', items: [
        'Service providers: Clerk (identity), Waffo Pancake (payments and subscriptions), Cloudflare (DNS and traffic protection), and the providers of our cloud host and database. They may process data only on our instructions.',
        'Legal requirements: we disclose what is necessary when we receive valid legal process, a court order or a regulatory requirement, and we notify you where the law allows it.',
        'Business transfers: in a merger, acquisition or sale of assets, personal information may transfer as part of the assets. We will require the recipient to honour this policy and will tell you in advance.',
        'Your consent: outside the cases above, we share only with your explicit consent.',
      ] },
      { kind: 'note', title: 'Card data', text: 'Handled by PCI-DSS compliant payment channels. It never passes through or rests on our servers; we see only the order number, subscription status and amount.' },
      { kind: 'links', items: [
        { label: 'Clerk privacy policy', href: 'https://clerk.com/legal/privacy' },
        { label: 'Waffo privacy policy', href: 'https://waffo.ai/privacy' },
        { label: 'Cloudflare privacy policy', href: 'https://www.cloudflare.com/privacypolicy/' },
      ] },
    ],
  },
  {
    id: 'security',
    number: '06',
    title: 'How we protect your data',
    blocks: [
      { kind: 'p', text: 'We apply measures proportionate to how sensitive the data is:' },
      { kind: 'list', items: [
        'The whole site is served over HTTPS with HSTS, so traffic between your browser and our servers is encrypted end to end.',
        'Sign-in is hosted by Clerk. We never see or store your password.',
        'Database rows are scoped by Clerk user ID; server credentials live only in server environment variables and are never shipped to the browser.',
        'Production access follows least privilege, and dependencies and runtime images are kept current.',
      ] },
      { kind: 'p', text: 'If a breach affects your rights, we will notify you and the relevant regulator as soon as it is confirmed. Where the law requires notice within 72 hours, we follow that deadline.' },
      { kind: 'p', text: 'No system is perfectly secure. Please protect your sign-in email and Google account, and contact us promptly if something looks wrong.' },
    ],
  },
  {
    id: 'retention',
    number: '07',
    title: 'How long we keep data',
    blocks: [
      { kind: 'p', text: 'We keep information only for as long as each purpose needs it.' },
      { kind: 'table', head: ['Data', 'Retention', 'At the end'], rows: [
        ['Account information (Clerk)', 'While your account exists', 'Deleted within 30 days of account deletion'],
        ['Projects, trades and drawings', 'While your account exists; you may delete them at any time', 'Deletion is immediate; cleared within 30 days of account deletion'],
        ['Payment and subscription events', 'As long as tax and accounting duties require', 'Deleted or anonymised after that'],
        ['Server access logs', 'Generally no more than 30 days', 'Overwritten by rotation'],
        ['Support emails', 'Up to 24 months after the issue is resolved', 'Deleted'],
        ['Browser local cache', 'On your own device', 'Until you clear browser data'],
      ] },
      { kind: 'p', text: 'Backup copies are overwritten within a 90-day rotation cycle. Information the law requires us to keep is isolated from ordinary systems and no longer used for any other purpose.' },
    ],
  },
  {
    id: 'your-rights',
    number: '08',
    title: 'Your rights',
    blocks: [
      { kind: 'p', text: 'Under the data protection law that applies to you — including the GDPR, the CCPA and China’s Personal Information Protection Law — you may:' },
      { kind: 'list', items: [
        'Ask whether we process your information and receive a copy of it.',
        'Correct inaccurate account information.',
        'Delete a practice project, or ask us to delete your account and its data.',
        'Restrict processing, or object to processing based on legitimate interests.',
        'Receive the practice data you provided in a structured, commonly used format.',
        'Withdraw consent at any time where processing relies on it.',
        'Complain to the data protection authority where you live.',
      ] },
      { kind: 'p', text: 'To exercise any of these, email privacy@grailab.top from, or naming, your account email. We may need to verify your identity first. We reply within 30 days of receiving the request.' },
      { kind: 'p', text: 'You can also delete practice projects directly in the workspace; clearing browser data removes the local cache. Deletion does not undo processing that was completed before it.' },
    ],
  },
  {
    id: 'marketing',
    number: '09',
    title: 'Marketing and opting out',
    blocks: [
      { kind: 'p', text: 'We do not send marketing emails or text messages today. We send only notices the service needs: subscription status, payment results, material policy changes and security alerts.' },
      { kind: 'p', text: 'If we introduce marketing, we will ask for your consent first, include an unsubscribe link in every message, and add a switch in account settings. Opting out never affects billing, security or other essential service notices.' },
    ],
  },
  {
    id: 'transfers',
    number: '10',
    title: 'International transfers',
    blocks: [
      { kind: 'p', text: 'Some providers we use are outside your country, so personal information may be transferred abroad for processing:' },
      { kind: 'list', items: [
        'Clerk: identity, primarily in the United States.',
        'Waffo Pancake: payments and subscription management.',
        'Cloudflare: DNS and traffic protection, processed at edge locations worldwide.',
      ] },
      { kind: 'p', text: 'For these transfers we rely on standard contractual clauses, each provider’s data processing agreement and encrypted transport, and we require recipients to protect data to a standard no lower than this policy. Where applicable law requires separate consent or additional notice, we provide it.' },
    ],
  },
  {
    id: 'minors',
    number: '11',
    title: 'Children and young people',
    blocks: [
      { kind: 'p', text: 'The service is intended for people aged 18 and over. It is not directed at minors, and we do not knowingly collect personal information from anyone under 18.' },
      { kind: 'p', text: 'If we learn that we collected information from someone under 18 without a guardian’s consent, we will delete it promptly. Parents and guardians can contact us at privacy@grailab.top.' },
    ],
  },
  {
    id: 'third-parties',
    number: '12',
    title: 'Third-party links and services',
    blocks: [
      { kind: 'p', text: 'This site links to third parties, including the Clerk sign-in page, Google sign-in, the Waffo checkout and external links in articles. Those pages are run by third parties and this policy does not apply to them.' },
      { kind: 'p', text: 'Market data comes from third-party data sources and contains only prices, never your personal information. Before giving personal information to a third party, we recommend reading its privacy policy.' },
    ],
  },
  {
    id: 'changes',
    number: '13',
    title: 'Changes to this policy',
    blocks: [
      { kind: 'p', text: 'We may update this policy to reflect changes in features, providers or legal requirements.' },
      { kind: 'p', text: 'Material changes are announced at least 14 days before they take effect, through the site or your account email. Other changes are reflected in the “Last updated” date on this page. Continuing to use the service after a change takes effect means you accept the updated policy.' },
      { kind: 'p', text: 'If you disagree with a change, you may stop using the service and ask us to delete your account data. Earlier versions are available on request at privacy@grailab.top.' },
    ],
  },
  {
    id: 'contact',
    number: '14',
    title: 'Contact us',
    blocks: [
      { kind: 'p', text: 'For anything about this policy, your personal information or a data request:' },
      { kind: 'list', items: [
        'Privacy and data requests: privacy@grailab.top',
        'General support: privacy@grailab.top, with “Support” in the subject line',
        'Operator: grailab',
        'Response time: an initial reply within 5 business days; rights requests completed within 30 days',
      ] },
      { kind: 'p', text: 'If you are not satisfied with our reply, you may complain to the data protection authority where you live. We would welcome the chance to resolve it with you directly first.' },
    ],
  },
]

export const policy: Record<Locale, PolicyCopy> = {
  zh: {
    nav: { home: '首页', articles: '文章', privacy: '隐私政策', label: '主导航' },
    title: '隐私政策',
    lead: '这份政策说明 grailab 在 grailab.top 上如何收集、使用与保存你的信息，以及你可以做什么。我们尽量把它写成能一次读完的长度。',
    meta: { updated: '最后更新', website: '适用网站', controller: '运营方', contact: '隐私联系' },
    updatedDisplay: '2026 年 11 月 6 日',
    summaryTitle: '要点摘要',
    summary: [
      { label: '我们收集什么', text: '登录账户信息、订阅状态、你保存的训练项目与模拟交易记录，以及维持服务运行所需的访问日志。' },
      { label: '我们不会做什么', text: '不出售你的个人信息，不投放广告，也不把你的训练数据用于训练第三方模型。' },
      { label: '数据存放在哪里', text: '账户与训练数据保存在我们的数据库；浏览器只保留离线缓存；银行卡信息不经过我们的服务器。' },
      { label: '你的选择', text: '随时删除训练项目，或邮件申请访问、导出与删除账户数据。' },
    ],
    tocTitle: '本页内容',
    tocAria: '本页内容',
    backToTop: '回到顶部',
    tableScroll: '可横向滚动的表格',
    tableHint: '左右滑动表格可查看完整内容。',
    sections: zhSections,
    end: { line: '本政策最后更新于 2026 年 11 月 6 日。如果读完仍有疑问，写信给我们，会有具体的人回复。', action: '写信给 privacy@grailab.top' },
    footer: { home: '首页', articles: '文章', privacy: '隐私政策', contact: '联系我们', disclaimer: '仅用于模拟交易训练，不构成投资建议。' },
    metaTitle: '隐私政策 | grailab',
    metaDescription: 'grailab 隐私政策：说明我们收集哪些信息、如何使用与保存、与谁共享，以及你可以行使的数据权利。',
  },
  en: {
    nav: { home: 'Home', articles: 'Articles', privacy: 'Privacy', label: 'Main navigation' },
    title: 'Privacy policy',
    lead: 'How grailab collects, uses and keeps your information on grailab.top, and what you can do about it. We have kept it short enough to read in one sitting.',
    meta: { updated: 'Last updated', website: 'Applies to', controller: 'Operator', contact: 'Privacy contact' },
    updatedDisplay: 'November 6, 2026',
    summaryTitle: 'In short',
    summary: [
      { label: 'What we collect', text: 'Your sign-in account, subscription status, the practice projects and simulated trades you save, and the access logs the service needs to run.' },
      { label: 'What we never do', text: 'We do not sell your personal information, run advertising, or use your practice data to train third-party models.' },
      { label: 'Where data lives', text: 'Accounts and practice data sit in our database. The browser keeps only an offline cache. Card details never pass through our servers.' },
      { label: 'Your choices', text: 'Delete a practice project at any time, or email us to access, export or delete your account data.' },
    ],
    tocTitle: 'On this page',
    tocAria: 'On this page',
    backToTop: 'Back to top',
    tableScroll: 'Table, scrollable horizontally',
    tableHint: 'Swipe the table sideways to see all of it.',
    sections: enSections,
    end: { line: 'This policy was last updated on November 6, 2026. If anything is still unclear, write to us — a real person answers.', action: 'Email privacy@grailab.top' },
    footer: { home: 'Home', articles: 'Articles', privacy: 'Privacy', contact: 'Contact', disclaimer: 'For simulated trading practice only. Not investment advice.' },
    metaTitle: 'Privacy policy | grailab',
    metaDescription: 'grailab privacy policy: what we collect, how we use and keep it, who we share it with, and the rights you can exercise.',
  },
}
