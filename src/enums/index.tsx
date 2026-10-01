import { Star } from '@gravity-ui/icons'
import { Enum } from 'enum-plus'

/**
 * @description: 请求状态
 */
export const RESPONSE = Enum({
  SUCCESS: { value: 200, label: '请求成功' },
  ERROR: { value: 500, label: '请求失败' },
})

/**
 * @description: 热榜子项
 */
export const HOT_ITEMS = Enum({
  'WEIBO': { value: 'weibo', label: '微博', tip: '热搜榜' },
  'NGA_TALK': { value: 'nga-talk', label: 'NGA·杂谈', tip: '水区/国际/历史' },
  'NGA_GAME': { value: 'nga-game', label: 'NGA·手综', tip: '手综/吃瓜' },
  'WEIBO_FRIENDS': { value: 'weibo-friends', label: '微博·关注流', tip: '关注博主' },
  // 2026-09-15 新增，按用户要求排在默认第 6 位
  'XHH': { value: 'xhh', label: '小黑盒', tip: '社区热帖' },
  'XIAOHONGSHU': { value: 'xiaohongshu', label: '小红书', tip: '实时热榜' },
  'BILIBILI': { value: 'bilibili', label: '哔哩哔哩', tip: '热门榜' },
  'DOUYIN': { value: 'douyin', label: '抖音', tip: '热点榜' },
  'ZHIHU': { value: 'zhihu', label: '知乎', tip: '热榜' },
  'THEPAPER': { value: 'thepaper', label: '澎湃新闻', tip: '热榜' },
  'BAIDU_TIEBA': { value: 'baidutieba', label: '百度贴吧', tip: '热议榜' },
  'QQ': { value: 'qq', label: '腾讯新闻', tip: '热点榜' },
  'HUPU': { value: 'hupu', label: '虎扑', tip: '步行街热帖', suffix: '亮' },
  'HELLO_GITHUB': { value: 'hello-github', label: 'HelloGithub', tip: '精选' },
  'GITHUB_TRENDING': { value: 'github-trending', label: 'Github', tip: '热门仓库', suffix: <Star width={12} /> },
  'JUEJIN': { value: 'juejin', label: '稀土掘金', tip: '热榜' },
  'CSDN': { value: 'csdn', label: 'CSDN', tip: '热榜' },
  '36KR': { value: '36kr', label: '36氪', tip: '24小时热榜' },
  'DOUBAN_MOVIC': { value: 'douban-movic', label: '豆瓣电影', tip: '新片榜' },
  'WEREAD': { value: 'weread', label: '微信读书', tip: '飙升榜' },
  'HUXIU': { value: 'huxiu', label: '虎嗅', tip: '最新资讯' },
  'TOUTIAO': { value: 'toutiao', label: '今日头条', tip: '热榜' },
  'BAIDU': { value: 'baidu', label: '百度', tip: '热搜榜' },
  'NETEASE': { value: 'netease', label: '网易新闻', tip: '热榜' },
  'KUAISHOU': { value: 'kuaishou', label: '快手', tip: '热榜' },
  'DONGCHEDI': { value: 'dongchedi', label: '懂车帝', tip: '热搜榜' },
  'HISTORY_TODAY': { value: 'history-today', label: '历史今天', tip: '历史上的今天' },
  'NETEASE_MUSIC': { value: 'netease-music', label: '网易云音乐', tip: '新歌榜' },
  'QUARK': { value: 'quark', label: '夸克', tip: '今日热点' },
  'WOSHIPM': { value: 'woshipm', label: '人人都是产品经理', tip: '热榜' },
  'IFANR': { value: 'ifanr', label: '爱范儿', tip: '快讯' },
  'ITHOME': { value: 'ithome', label: 'IT之家', tip: '热榜' },
  'EASTMONEY_724': { value: 'eastmoney-724', label: '东财·快讯', tip: '7×24财经快讯' },
  'JIN10': { value: 'jin10', label: '金十数据', tip: '财经快讯' },
  'QBITAI': { value: 'qbitai', label: '量子位', tip: 'AI资讯' },
  'LEIPHONE_AI': { value: 'leiphone-ai', label: '雷峰网·AI', tip: '人工智能' },
})
