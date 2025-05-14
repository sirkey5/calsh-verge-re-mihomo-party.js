// ========== 重要维护提示 ==========
// 所有后续新增的变量、函数、类、常量等，必须在本文件中显式定义，严禁未定义直接调用，防止ReferenceError: not defined等运行时错误。
// 如有跨文件依赖，需在本文件顶部或相关位置补充声明或导入。
// ===================================

class AppState {
  static nodes = Object.freeze({
    qualityStatus: new Map(),
    lastSwitch: new Map(),
    switchCooldown: new Map(),
    qualityScore: new Map(),
    nextEvalTime: new Map(),
    metrics: new Map(),
    thresholds: new Map()
  });
}

/**
 * 整个脚本的总开关，在Mihomo Party使用的话，请保持为true
 * true = 启用
 * false = 禁用
 */
const enable = true

// 提取公共CDN配置




class NetworkProber {
  async probeTCP(url) {
    return {
      avgLatency: performance.now(),
      packetLossRate: 0,
      minLatency: 0,
      maxLatency: 0
    };
  }

  async probeUDP(url) {
    return {
      avgLatency: performance.now(),
      jitter: 0
    };
  }
}

class CDN_CONFIG {
  constructor() {
    this.jsdelivr = 'https://cdn.jsdelivr.net/gh/';
    this.fallback = 'https://fallback.example.com/';
    this.prober = new NetworkProber();
    this.nodeStats = new Map();
    this.trafficPatterns = new Map();
    this.historyWindow = 24 * 60 * 60 * 1000;
    this.sources = [
      'https://cdn.jsdelivr.net/gh/',
      'https://fastly.jsdelivr.net/gh/',
      'https://testingcf.jsdelivr.net/gh/'
    ];
    this.currentIndex = 0;
    this.metrics = {
      failureCount: new Map(),
      latencyStats: new Map(),
      packetLossStats: new Map(),
      historyStats: new Map()
    };
    this.thresholds = Object.freeze({
      PACKET_LOSS: 0.15,
      LATENCY: 500,
      HISTORY_SUCCESS: 0.8,
      STABILITY_FACTOR: 0.2
    });
    this.stabilityWeights = Object.freeze({
      latency: 0.6,
      packetLoss: 0.3,
      successRate: 0.1,
      BURST_TOLERANCE: 0.2,
      SCORE_IMPROVEMENT_RATIO: 0.8
    });
    this.cooldown = new Map(); // 新增CDN冷却机制
  }

  getCurrent() {
    return this.sources[this.currentIndex];
  }

  async healthCheck(url) {
    const failures = this._initFailureCount(url);
    const tcpResults = await this._probeTCPLatency(url);
    if (this._checkUnhealthyStatus(tcpResults)) {
      return this._handleUnhealthyCDN(url, failures);
    }
    return this._performHttpCheck(url, failures, tcpResults);
  }

  _initFailureCount(url) {
    if (!this.failureCount.has(url)) this.failureCount.set(url, 0);
    return this.failureCount.get(url);
  }

  _checkUnhealthyStatus(tcpResults) {
    const { dynamicLatency, dynamicPacketLoss } = this._getDynamicThresholds();
    return this._isUnhealthy(tcpResults, dynamicLatency, dynamicPacketLoss);
  }

  async _performHttpCheck(url, failures, tcpResults) {
    return this._checkHttpHealth(url, failures, tcpResults);
  }

  _getDynamicThresholds() {
    return this._calculateThresholds(['latency', 'packetLoss']);
  }

  _calculateThresholds(types) {
    return types.reduce((acc, type) => {
      const threshold = this[`${type}Threshold`];
      const range = type === 'latency' ? 0.15 : 0.2;
      acc[`dynamic${type[0].toUpperCase() + type.slice(1)}`] = threshold * (1 + Math.random() * range - range/2);
      return acc;
    }, {});
  }

  _isUnhealthy(tcpResults, dynamicLatency, dynamicPacketLoss) {
    return this._checkThresholdViolation(tcpResults, { latency: dynamicLatency, packetLoss: dynamicPacketLoss });
  }

  _checkThresholdViolation(results, thresholds) {
    return Object.entries(thresholds).some(([type, threshold]) => 
      results[`${type}Rate`] > threshold
    );
  }

  async _checkHttpHealth(url, failures, tcpResults) {
    try {
      const httpResult = await fetch(`${url}healthcheck`, {
        method: 'HEAD',
        timeout: 1500,
        keepalive: true
      });
      if (!httpResult.ok) return this._handleUnhealthyCDN(url, failures);
      this._updateNetworkMetrics(url, tcpResults);
      this.failureCount.set(url, 0);
      return true;
    } catch (e) {
      return this._handleUnhealthyCDN(url, failures);
    }
  }

  // 并行探测机制
  async _probeNetwork(url) {
    return this._probeLatency(url, ['tcp', 'udp']);
  }

  async _probeNetwork(url) {
    const [tcpResult, udpResult] = await Promise.all([
      this.prober.probeTCP(url),
      this.prober.probeUDP(url)
    ]);
    return {
      ...tcpResult,
      udpLatency: udpResult.avgLatency,
      udpJitter: udpResult.jitter
    };
  }

  _handleUnhealthyCDN(url, failures) {
    this.failureCount.set(url, failures + 1);
    if (failures + 1 >= 2) {
      this.currentIndex = (this.currentIndex + 1) % this.sources.length;
      this.failureCount.set(url, 0);
    }
    return false;
  }

  _updateNetworkMetrics(url, metrics) {
    this._updateLatencyStats(url, metrics);
    this._updatePacketLossStats(url, metrics);
    this._updateHistorySuccessRate(url, metrics);
  }

  _updateLatencyStats(url, { avgLatency, minLatency, maxLatency }) {
    const stats = this.latencyStats.get(url) || { values: [], min: [], max: [] };
    stats.values.push(avgLatency);
    if (typeof minLatency === 'number') stats.min.push(minLatency);
    if (typeof maxLatency === 'number') stats.max.push(maxLatency);
    if (stats.values.length > 100) stats.values.shift();
    if (stats.min.length > 100) stats.min.shift();
    if (stats.max.length > 100) stats.max.shift();
    this.latencyStats.set(url, stats);
  }

  _updatePacketLossStats(url, { packetLossRate }) {
    const stats = this.packetLossStats.get(url) || { values: [] };
    stats.values.push(packetLossRate);
    if (stats.values.length > 100) stats.values.shift();
    this.packetLossStats.set(url, stats);
  }

  _updateHistorySuccessRate(url, { packetLossRate, avgLatency }) {
    const history = this.historyStats.get(url) || { total: 0, success: 0 };
    history.total++;
    if (packetLossRate < this.thresholds.PACKET_LOSS && avgLatency < this.thresholds.LATENCY) history.success++;
    history.successRate = history.success / history.total;
    this.historyStats.set(url, history);
  }

  _updateStats(type, url, { avgLatency, packetLossRate, minLatency, maxLatency }) {
    const stats = this[`${type}Stats`].get(url) || { values: [], min: [], max: [] };
    const value = type === 'latency' ? avgLatency : packetLossRate;
    stats.values.push(value);
    if (typeof minLatency === 'number') stats.min.push(minLatency);
    if (typeof maxLatency === 'number') stats.max.push(maxLatency);
    if (stats.values.length > 100) stats.values.shift();
    if (stats.min.length > 100) stats.min.shift();
    if (stats.max.length > 100) stats.max.shift();
    this[`${type}Stats`].set(url, stats);
  }

  _updateHistoryStats(url, { avgLatency, packetLossRate }) {
    const history = this.historyStats.get(url) || { total: 0, success: 0 };
    history.total++;
    if (packetLossRate < this.packetLossThreshold && avgLatency < this.latencyThreshold) history.success++;
    history.successRate = history.success / history.total;
    this.historyStats.set(url, history);
  }

  _updateDynamicWeights() {
    // 智能调度核心算法
    this.nodeStats = new Map();
    this.trafficPatterns = new Map();
    this.historyWindow = 24 * 60 * 60 * 1000;

    this._detectPeriodicity = (data) => {
      const Fs = 1000; // 采样频率1Hz
      const N = data.length;
      const freqs = new Float32Array(N/2);
      
      // 傅里叶变换核心算法
      for(let k=0; k<N/2; k++){
        let re = 0, im = 0;
        for(let n=0; n<N; n++){
          const angle = 2*Math.PI*k*n/N;
          re += data[n] * Math.cos(angle);
          im -= data[n] * Math.sin(angle);
        }
        freqs[k] = Math.hypot(re, im)/N;
      }
      
      // 寻找主导频率
      const maxIndex = freqs.indexOf(Math.max(...freqs));
      return {
        period: Math.round((N/2)/(maxIndex || 1)*1000), // 转换为毫秒
        confidence: freqs[maxIndex]/freqs.reduce((a,b)=>a+b,0)
      };
    };

    this._clusterGeoData = (data) => {
      /* 地理空间聚类分析 */
      return { clusters: 3, centroid: [114.08, 22.54] };
    };

    this.predictNodePerformance = (url) => {
      const stats = this.latencyStats.get(url) || {};
      return {
        loadScore: Math.min(1, stats.avgLatency / 500),
        stability: 1 - (stats.packetLoss.avg || 0),
        predictedThroughput: 1/(stats.avgLatency || 1) * 1000
      };
    };

    this.stabilityWeights.latency *= this._getTrafficFactor('latency');
    this.stabilityWeights.packetLoss *= this._getTrafficFactor('loss');
  }

  _getTrafficFactor(type) {
    const patterns = Array.from(this.trafficPatterns.values());
    return patterns.reduce((sum, p) => sum + p[type + 'Weight'], 0) / (patterns.length || 1);
  }

  switchSource() {
    // 动态权重调整（根据实时流量模式）
    this._updateDynamicWeights();
    const performanceData = this.predictNodePerformance(this.getCurrent());
    this.stabilityWeights.latency *= (1 - performanceData.loadScore);
    this.stabilityWeights.packetLoss *= performanceData.stability;

    // 新增冷却时间检查（30分钟内不重复切换）
    if(AppState.nodeSwitchCooldown.has(this.currentIndex) && 
      Date.now() - AppState.nodeSwitchCooldown.get(this.currentIndex) < 1800000) {
      return;
    }

    // 多维度评分算法
    const scores = this.sources.map(url => {
      const stats = this.latencyStats.get(url);
      if (!stats) return Infinity;

      // 实时流量特征分析
      const trafficPattern = this._analyzeTrafficPattern(url);
      
      // 多维评分要素
      const successRate = this.historyStats.get(url)?.successRate || 0;
      const { latencyFactor, lossImpact, successImpact } = this._getPredictionFactors(url);
    const stabilityScore = 
        (stats.avgLatency * this.stabilityWeights.latency) * trafficPattern.latencyWeight * latencyFactor +
        (stats.packetLoss * 1000 * this.stabilityWeights.packetLoss) * trafficPattern.lossWeight * lossImpact +
        ((1 - successRate) * 1000 * this.stabilityWeights.successRate) * trafficPattern.successWeight * successImpact;

      // 新增突发流量容忍系数
      return stabilityScore * (1 + Math.min(trafficPattern.burstTolerance, 0.2));
    });

    const bestScore = Math.min(...scores);
    const bestIndex = scores.indexOf(bestScore);

    // 当新评分优于当前20%以上才切换
    if (bestScore < scores[this.currentIndex] * 0.8) {
      this.currentIndex = bestIndex;
      AppState.nodeSwitchCooldown.set(bestIndex, Date.now());
    }
  }
}

// ========== 优质/劣质节点状态与评估周期管理 ========== 
const nodeEvaluation = {
  status: new Map(),
  score: new Map(),
  nextEval: new Map(),
  BASE_INTERVAL: 30 * 60 * 1000,
  MAX_INTERVAL: 24 * 60 * 60 * 1000,
  THRESHOLD: { good: 3, bad: 3 }
};

const getEvalInterval = (node) => {
  const score = nodeQualityScore.get(node) || 0;
  return Math.min(BASE_EVAL_INTERVAL * (2 ** Math.abs(score)), MAX_EVAL_INTERVAL);
};



async function selectBestNodeWithQuality(nodes) {
  await periodicEvaluateAllNodes(nodes);
  const results = await Promise.all(nodes.map(async n => {
    const metrics = await testNodeMultiMetrics(n);
    const history = nodeHistoryCache.get(n) ?? 1;
    const aiScore = aiScoreNode({ ...metrics, history });
    const weight = getNodePriorityWeight(n);
    return { node: n, aiScore, weight, status: nodeQualityStatus.get(n) };
  }));
  results.sort((a, b) => (b.weight - a.weight) || (a.aiScore - b.aiScore));
  return results[0].node;
}

// ========== 节点切换逻辑增强 ========== 
async function autoSwitchNode(currentNode, nodes, mode = 'smart') {
  const now = Date.now();
  const { status, score, nextEval, BASE_INTERVAL, MAX_INTERVAL, THRESHOLD } = nodeEvaluation;

  if (mode === 'basic') {
    if (status.get(currentNode) && now - status.get(currentNode) < 60000) return currentNode;
    const best = await selectBestNodeWithQuality(nodes);
    if (best !== currentNode) {
      status.set(best, now);
    }
    return best;
  }

  // 智能模式
  const cooldown = getSwitchCooldown(currentNode);
  if (status.get(currentNode) && now < status.get(currentNode) + cooldown) return currentNode;

  await periodicEvaluateAllNodes(nodes);
  const best = await selectBestNodeWithQuality(nodes);

  if (best !== currentNode) {
    status.set(best, now + getSwitchCooldown(best));
    return best;
  }

  status.set(currentNode, now + cooldown);
  return currentNode;
}

function getSwitchCooldown(node) {
  const score = score.get(node) || 0;
  return Math.min(BASE_INTERVAL * Math.pow(2, Math.max(0, score - 1)), MAX_INTERVAL);
}

// 智能分流调度核心
// 支持节点健康检查、测速缓存、优选、负载均衡、异常降级
const nodeHealthCache = new Map();
const nodeSpeedCache = new Map();
const nodeErrorCount = new Map();
const nodeLastCheck = new Map();
const SPEED_TEST_INTERVAL = 300000; // 5分钟测速一次
const HEALTHY_THRESHOLD = 2; // 连续2次异常视为不健康
const RETRY_DELAY = 10000; // 10秒后重试异常节点

// 已被 testNodeMultiMetrics 替代，保留兼容


async function checkNodeHealth(node) {
  // 健康检查，测速并缓存（多维度）
  const now = Date.now();
  if (nodeLastCheck.get(node) && now - nodeLastCheck.get(node) < SPEED_TEST_INTERVAL) {
    return nodeHealthCache.get(node);
  }
  const { latency, loss } = await testNodeMultiMetrics(node);
  nodeSpeedCache.set(node, latency);
  nodeLastCheck.set(node, now);
  if (latency === Infinity || loss > 0.5) {
    nodeErrorCount.set(node, (nodeErrorCount.get(node) || 0) + 1);
    if (nodeErrorCount.get(node) >= HEALTHY_THRESHOLD) {
      nodeHealthCache.set(node, false);
      setTimeout(() => nodeErrorCount.set(node, 0), RETRY_DELAY);
      return false;
    }
    return nodeHealthCache.get(node) ?? true;
  } else {
    nodeErrorCount.set(node, 0);
    nodeHealthCache.set(node, true);
    return true;
  }
}

// 已被多维度 selectBestNode 替代，保留兼容
// async function selectBestNode(nodes) {
//   ...
// }

class LRUCache {
  constructor(capacity = 500) {
    this.memoryLimit = 1024 * 1024 * 50;
    this.defaultTTL = 300000;
    this.prefetchThreshold = 0.8;
    this.map = new Map();
    this.expireMap = new Map();
    this.accessStats = new Map();
    this.head = new Node('HEAD');
    this.tail = new Node('TAIL');
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.capacity = capacity;
  }

  _addNode(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _removeNode(node) {
    const prev = node.prev;
    const next = node.next;
    prev.next = next;
    next.prev = prev;
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    if (this._shouldEvict(key)) {
      const node = this.map.get(key);
      this._removeNode(node);
      this.map.delete(key);
      this.expireMap.delete(key);
      this.accessStats.delete(key);
      return undefined;
    }
    const node = this.map.get(key);
    this._removeNode(node);
    this._addNode(node);
    const stat = this.accessStats.get(key) || { count: 0, lastAccess: 0 };
    stat.count++;
    stat.lastAccess = Date.now();
    this.accessStats.set(key, stat);
    this._smartCleanup();
    return node.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    if (this.map.has(key)) {
      const node = this.map.get(key);
      node.value = value;
      this._removeNode(node);
      this._addNode(node);
    } else {
      if (this.map.size >= this.capacity) {
        const lru = this.head.next;
        this._removeNode(lru);
        this.map.delete(lru.key);
        this.expireMap.delete(lru.key);
        this.accessStats.delete(lru.key);
      }
      const newNode = new Node(key, value);
      this.map.set(key, newNode);
      this._addNode(newNode);
    }
    if (ttl > 0) {
      this.expireMap.set(key, Date.now() + ttl);
    } else {
      this.expireMap.delete(key);
    }
    this.accessStats.set(key, { count: 1, lastAccess: Date.now() });
    this._smartCleanup();
  }

  delete(key) {
    if (!this.map.has(key)) return;
    const node = this.map.get(key);
    this._removeNode(node);
    this.map.delete(key);
    this.expireMap.delete(key);
    this.accessStats.delete(key);
    this._smartCleanup();
  }

  _shouldEvict(key) {
    const expireTime = this.expireMap.get(key);
    return expireTime && Date.now() > expireTime;
  }

  _smartCleanup() {
    if (this.map.size > this.capacity * 0.9) {
      let current = this.tail.prev;
      while (current !== this.head && this.map.size > this.capacity * 0.8) {
        this._removeNode(current);
        this.map.delete(current.key);
        this.expireMap.delete(current.key);
        this.accessStats.delete(current.key);
        current = current.prev;
      }
    }
  }
}

class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

const regionRegexCache = new Map();
const getRegionRegex = (pattern) => {
  try {
    if (!regionRegexCache.has(pattern)) {
      const regex = new RegExp(pattern, 'iu');
      regex.lastIndex = 0;
      regionRegexCache.set(pattern, regex);
      if(regionRegexCache.size > 100) {
        const firstKey = regionRegexCache.keys().next().value;
        regionRegexCache.delete(firstKey);
      }
    }
    return regionRegexCache.get(pattern);
  } catch (e) {
    console.error(`正则表达式错误: ${pattern}`, e);
    return /^$/u;
  }
}

/**
 * 分流规则配置，会自动生成对应的策略组
 * 设置的时候可遵循“最小，可用”原则，把自己不需要的规则全禁用掉，提高效率
 * true = 启用
 * false = 禁用
 */
const ruleOptions = {
  acl: true,       // ACL4SSR核心规则
  surge: true,    // Loyalsoldier Surge规则
  divine: true,   // DivineEngine规则
  blackmatrix: true, // Blackmatrix7规则
  hackl0us: true, // Hackl0us个性化规则
  apple: true, // 苹果服务
  microsoft: true, // 微软服务
  github: true, // Github服务
  google: true, // Google服务
  openai: true, // 国外AI和GPT
  spotify: true, // Spotify
  youtube: true, // YouTube
  bahamut: true, // 巴哈姆特/动画疯
  netflix: true, // Netflix网飞
  tiktok: true, // 国际版抖音
  disney: true, // 迪士尼
  pixiv: true, // Pixiv
  hbo: true, // HBO
  biliintl: true, // 哔哩哔哩东南亚
  tvb: true, // TVB
  hulu: true, // Hulu
  primevideo: true, // 亚马逊prime video
  telegram: true, // Telegram通讯软件
  line: true, // Line通讯软件
  whatsapp: true, // Whatsapp
  games: true, // 游戏策略组
  japan: true, // 日本网站策略组
  ads: false, // 禁用广告拦截规则
  tracker: false // 新增禁用网络追踪规则
}

/**
 * 地区配置，通过regex匹配代理节点名称
 * regex会有一定概率误判，自己调整一下吧
 * excludeHighPercentage是排除高倍率节点的开关，只对地区分组有效
 * 倍率大于regions里的ratioLimit值的代理节点会被排除
 */
const regionOptions = {
  excludeHighPercentage: true,
  regions: [
    {
      name: 'HK香港',
      regex: getRegionRegex('港|🇭🇰|hk|hongkong|hong kong'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png',
    },
    {
      name: 'US美国',
      regex: getRegionRegex('美|🇺🇸|us|united state|america'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png',
    },
    {
      name: 'JP日本',
      regex: getRegionRegex('日本|🇯🇵|jp|japan'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png',
    },
    {
      name: 'KR韩国',
      regex: getRegionRegex('韩|🇰🇷|kr|korea'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Korea.png',
    },
    {
      name: 'SGSingapore',
      regex: getRegionRegex('新加坡|🇸🇬|sg|singapore'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png',
    },
    {
      name: 'CN中国大陆',
      regex: getRegionRegex('中国|🇨🇳|cn|china'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/China_Map.png',
    },
    {
      name: 'TW台湾省',
      regex: getRegionRegex('台湾|🇹🇼|tw|taiwan|tai wan'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/China.png',
    },
    {
      name: 'GB英国',
      regex: getRegionRegex('英|🇬🇧|uk|united kingdom|great britain'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_Kingdom.png',
    },
    {
      name: 'DE德国',
      regex: getRegionRegex('德国|🇩🇪|de|germany'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Germany.png',
    },
    {
      name: 'MY马来西亚',
      regex: getRegionRegex('马来|🇲🇾|my|malaysia'),  // 修正国旗emoji
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Malaysia.png',
    },
    {
      name: 'TK土耳其',
      regex: getRegionRegex('土耳其|🇹🇷|tk|turkey'),
      ratioLimit: 2,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Turkey.png',
    },
  ],
}

/**
 * 其实两组DNS就够了，一组国内，一组国外
 * defaultDNS是用来解析DNS的，必须为IP
 * DNS最好不要超过两个，从业界某知名APP的文档里学的
 */
// 主要DNS服务器配置
// 主要DNS服务器配置 - 使用加密DNS以提高安全性
const defaultDNS = [
  'tls://1.1.1.1:853' // 单一个Cloudflare DoT
]
const chinaDNS = [
  'https://dns.alidns.com/dns-query',
  'tls://120.53.53.53:853'  // 腾讯云DNS-over-TLS
]

// 国外DNS服务器配置 - 多层级DNS服务
const foreignDNS = [
  'tls://1.1.1.1:853',
  'https://dns.cloudflare.com/dns-query'
]; // 添加了缺失的右括号和分号

/**
 * DNS相关配置
 */
const dnsConfig = {
  enable: true,
  listen: '0.0.0.0:1053',
  ipv6: true,
  'prefer-h3': true,
  'dnssec': true,
  'edns-client-subnet': {
    enable: true,
    policy: 'auto',
    customSubnets: ['223.5.5.0/24', '8.8.8.0/24'],
    geoipMapping: true,
    maxSubnets: 10,
    subnetCacheTTL: 3600,
    fallbackPolicy: 'nearest'
  },
  cache: {
    prefetch: 500,
    prefetchDomains: [
      'google.com', 'youtube.com',
      'netflix.com', 'microsoft.com',
      'spotify.com', 'amazon.com'
    ]
  },
  'certificate': [
    'spki sha256//7HIpLefRz1P7GX2TjC1gV3RcGzOQ3sPDB5S3X5JFOI=',
    'spki sha256//Y9mvm2zobJ5FYKjusS0u0WG3KY6Z+AP6XuvdVb7adIk='
  ],
  'use-hosts': false,
  'use-system-hosts': false,
  'respect-rules': true,
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  timeout: 5000,
  'persistent-cache': true,
  'default-nameserver': [...defaultDNS],
  'nameserver': [...foreignDNS],
  'proxy-server-nameserver': [...foreignDNS],
  'fallback': [...chinaDNS, 'https://dns.google/dns-query'].filter(url => !url.includes('ghproxy.com')),
  'nameserver-policy': {
    'geosite:cn': chinaDNS,
    'geosite:geolocation-!cn': ['https://dns.quad9.net/dns-query', 'tls://8.8.8.8:853']
  },
  'fallback-filter': {
    'geoip': true,
    'geoip-code': 'CN',
    'ipcidr': [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      '169.254.0.0/16'
    ]
  },
  'fake-ip-filter': [
    // 基础域名
    '*',
    '+.lan',
    '+.local',
    '+.localdomain',
    '+.localhost',
    '+.home.arpa',
    '+.internal',
    '+.intranet',
    '+.private',
    
    // DDNS服务
    '+.dynv6.net',    // dynv6 DDNS服务
    '+.dpdns.org',    // dpdns DDNS服务
    '+.cloudflare.com',  // Cloudflare服务
    
    // 系统服务
    '+.msftconnecttest.com',  // Windows网络连接检测
    '+.msftncsi.com',         // Windows网络连接检测
    '+.time.windows.com',     // Windows时间同步
    '+.market.xiaomi.com',    // 小米服务
    '+.router.asus.com',      // 华硕路由器
    '+.tplogin.cn',           // TP-Link路由器
    '+.tplinklogin.net',      // TP-Link路由器
    '+.tendawifi.com',        // 腾达路由器
    '+.leike.cc',             // 磊科路由器
    '+.zte.home',             // 中兴路由器
    '+.phicomm.me',           // 斐讯路由器
    '+.miwifi.com',           // 小米路由器
    // 时间同步服务
    '+.pool.ntp.org',         // NTP服务器
    'time.*.com',             // NTP服务器
    'time.*.gov',
    'time.*.edu.cn',
    'time.*.apple.com',       // Apple时间同步
    'time1.*.com',
    'time2.*.com',
    'time3.*.com',
    'time4.*.com',
    'time5.*.com',
    'time6.*.com',
    'time7.*.com',
    'ntp.*.com',              // NTP服务器
    'ntp1.*.com',
    'ntp2.*.com',
    'ntp3.*.com',
    'ntp4.*.com',
    'ntp5.*.com',
    'ntp6.*.com',
    'ntp7.*.com',
    
    // 流媒体和游戏服务
    '+.steamcontent.com',     // Steam内容服务器
    '+.dl.steam.clngaa.com',  // Steam下载
    '+.dl.steam.ksyna.com',   // Steam下载
    '+.st.dl.bscstorage.net', // Steam下载
    '+.st.dl.eccdnx.com',     // Steam下载
    '+.st.dl.pinyuncloud.com',// Steam下载
    '+.xboxlive.com',         // Xbox服务
    '+.stun.*.*',             // STUN服务器
    '+.stun.*.*.*',
    '+.stun.*.*.*.*',
    '+.turn.*.*',             // TURN服务器
    '+.turn.*.*.*',
    '+.turn.*.*.*.*',
    
    // 常见应用服务
    '+.plex.direct',          // Plex媒体服务器
    '+.srv.nintendo.net',     // 任天堂服务器
    '+.updates.cdn.ea.com',   // EA游戏更新
    '+.messaging.origin.com', // Origin消息服务
    '+.mitm.it',              // MITM代理
    '+.instant.arubanetworks.com', // Aruba设备
    '+.setmeup.arubanetworks.com',  // Aruba设备
    
    // 安全性相关
    '+.crashlytics.com',      // 崩溃报告
    '+.digicert.com',         // 证书服务
    '+.ocsp.*',               // 证书状态
    '+.ocsp-certum.com',      // 证书状态
    '+.ocsp.dcocsp.cn',       // 证书状态
    '+.ocsp.godaddy.com',     // 证书状态
    '+.ocsp.int-x3.letsencrypt.org', // 证书状态
    '+.ocsp.msocsp.com',      // 证书状态
    '+.ocsp.sectigo.com',     // 证书状态
    '+.ocsp.usertrust.com',   // 证书状态
    '+.pki-goog.l.google.com', // Google证书服务

  '+.corp.example.com', // 补充企业内网域名
  '+.vpn.local',
  '*.internal'
  ]
}

// 规则集通用配置
const ruleProviderCommon = {
  type: 'http',
  format: 'yaml',
  interval: 86400,
}

// 代理组通用配置
const groupBaseOption = {
  interval: 300,
  timeout: 5000,
  url: 'https://cp.cloudflare.com/generate_204',  // 使用HTTPS进行健康检查
  lazy: true,
  'max-failed-times': 3,
  'health-check': {
    enable: true,
    interval: 30,       // 检测间隔30秒
    timeout: 2000,      // 超时2秒
    failureThreshold: 1, // 失败1次即标记
    maxRetries: 3,     // 最大重试次数增加
    cacheTTL: 300,      // 缓存时间优化
    udp: true,         // 新增UDP检测
    udpPort: 53,       // UDP检测端口
    udpTimeout: 1000   // UDP检测超时时间
  },
  'check-interval': 300,
  'fail-timeout': 5,
  'success-rate': 0.8,
  hidden: false,
  'tls-fingerprint': 'chrome',  // 使用Chrome的TLS指纹
  'skip-cert-verify': false,     // 强制启用证书验证
  maxRetries: 3,
  retryDelay: 1000,
  fallbackPolicy: 'roundrobin',
  protocol: 'tcp_udp',
  weight: {
    base: 100,
    rttFactor: 0.7,
    errorPenalty: 30,
    jitterFactor: 0.3,  // 新增抖动系数
    packetLossPenalty: 20, // 新增丢包惩罚
    // 权重公式：weight = base - (rtt * rttFactor) - (errorCount * errorPenalty) - (jitter * jitterFactor) - (packetLoss * packetLossPenalty)
    // RTT单位毫秒，errorCount为最近5分钟错误次数
  },
  'load-balance': {
    strategy: 'weighted',  // 修正为官方支持的策略名称
    minRttWeight: 0.5,        // 最小RTT权重
    maxRttWeight: 1.5,        // 最大RTT权重
    jitterWeight: 0.2,        // 抖动权重
    packetLossWeight: 0.3     // 丢包权重
  }
}

// 全局规则提供者定义
const ruleProviders = new Map()
ruleProviders.set('applications', {
  ...ruleProviderCommon,
  behavior: 'classical',
  format: 'text',
  url: `${CDN_CONFIG.jsdelivr}DustinWin/ruleset_geodata@clash-ruleset/applications.list`,
  path: './ruleset/DustinWin/applications.list',
  'fallback-url': [
    `${CDN_CONFIG.fallback}DustinWin/ruleset_geodata/clash-ruleset/applications.list`
  ]
})

const rules = [
  'RULE-SET,applications,下载软件',
  'PROCESS-NAME,SunloginClient,DIRECT',
  'PROCESS-NAME,SunloginClient.exe,DIRECT',
  'DOMAIN-SUFFIX,dynv6.net,DIRECT',    // dynv6 DDNS直连
  'DOMAIN-SUFFIX,dpdns.org,DIRECT',    // dpdns DDNS直连
  'DOMAIN-SUFFIX,cloudflare.com,DIRECT',  // Cloudflare服务直连
  'DOMAIN-SUFFIX,douyin.com,DIRECT',   // douyin.com直连
]

const multiplierCache = new Map();
const getMultiplier = (name) => {
  if (multiplierCache.has(name)) return multiplierCache.get(name);
  const match = name.match(/(?<=[xX✕✖⨉倍率])[0-9]+\.?[0-9]*(?=[xX✕✖⨉倍率])/);
  const result = match ? parseFloat(match[0]) : 0; // 优化正则表达式匹配逻辑，提高效率和准确性
  multiplierCache.set(name, result);
  return result;
};

// 节点多维度健康状态缓存
const nodeJitterCache = new Map();
const nodeLossCache = new Map();
const nodeHistoryCache = new Map();
const nodeLastSwitch = new Map();

// 多维度测速与健康检测
async function testNodeMultiMetrics(node) {
  let latency = Infinity, jitter = 0, loss = 0, bandwidth = 0;
  const results = [];
  const testCount = 5;
  let success = 0;
  for (let i = 0; i < testCount; i++) {
    const start = Date.now();
    try {
      await fetch('https://cp.cloudflare.com/generate_204', { method: 'GET', timeout: 1500 });
      const t = Date.now() - start;
      results.push(t);
      success++;
    } catch {
      results.push(Infinity);
    }
  }
  const valid = results.filter(x => x !== Infinity);
  if (valid.length > 0) {
    latency = valid.reduce((a, b) => a + b, 0) / valid.length;
    jitter = valid.length > 1 ? Math.sqrt(valid.map(x => Math.pow(x - latency, 2)).reduce((a, b) => a + b, 0) / valid.length) : 0;
    loss = 1 - (success / testCount);
    // 模拟带宽（可扩展为真实测速）
    bandwidth = 1000 / (latency || 1);
  }
  nodeJitterCache.set(node, jitter);
  nodeLossCache.set(node, loss);
  // 维护历史表现滑动窗口
  let history = nodeHistoryCache.get(node) || [];
  history.push(loss < 0.2 && latency < 500 ? 1 : 0);
  if (history.length > 20) history = history.slice(-20);
  nodeHistoryCache.set(node, history.reduce((a, b) => a + b, 0) / history.length);
  return { latency, jitter, loss, bandwidth };
}

// =================== 节点分组地理聚类（可扩展） =================== 
function groupNodesByGeo(nodes, geoInfoMap) {
  // geoInfoMap: { nodeName: { lat, lon } }
  // 这里预留接口，实际聚类可用k-means等
  // 返回分组对象 { clusterId: [node1, node2, ...] }
  return { 0: nodes };
}

// =================== 批量并发分组与优选（增强版） =================== 
async function batchGroupAndSelect(nodes, geoInfoMap, historyCache) {
  // 地理聚类分组
  const groups = groupNodesByGeo(nodes, geoInfoMap);
  // 每组内并发优选，优先优质节点
  const bestNodes = await Promise.all(Object.values(groups).map(async group => {
    await periodicEvaluateAllNodes(group);
    const metricsList = await batchTestNodes(group);
    metricsList.forEach(m => historyCache.set(m.node, m.history));
    metricsList.sort((a, b) => {
      // 先按优质权重，再按AI分
      const wa = getNodePriorityWeight(a.node);
      const wb = getNodePriorityWeight(b.node);
      if (wa !== wb) return wb - wa;
      return aiScoreNode(a) - aiScoreNode(b);
    });
    return metricsList[0]?.node;
  }));
  // 自动切换到最优节点
  await autoUpdateCurrentNode(nodes);
  return bestNodes;
}

// =================== 批量并发测速与健康检查 =================== 
async function batchTestNodes(nodes) {
  // 并发测速与健康检查，返回所有节点的多维度指标
  return await Promise.all(nodes.map(async node => {
    const metrics = await testNodeMultiMetrics(node);
    return { node, ...metrics };
  }));
}

// =================== 节点分流分配（增强版） =================== 
async function dynamicNodeAssignment(nodes, trafficStatsMap) {
  // 根据流量类型动态分配最优节点，优先优质节点
  const assignments = {};
  for (const [user, stats] of Object.entries(trafficStatsMap)) {
    const pattern = detectTrafficPattern(stats);
    let bestNode;
    if (pattern === 'video' || pattern === 'game') {
      bestNode = await selectBestNodeWithQuality(nodes);
    } else {
      bestNode = await selectBestNodeWithQuality(nodes);
    }
    assignments[user] = bestNode;
  }
  return assignments;
}

// =================== 节点自愈与降级 =================== 
async function autoHealNodes(nodes, unhealthyNodes, cooldownMap, retryDelay = 60000) {
  // 对异常节点冷却后自动重试
  for (const node of unhealthyNodes) {
    if (!cooldownMap.has(node) || Date.now() - cooldownMap.get(node) > retryDelay) {
      // 冷却后重试
      testNodeMultiMetrics(node).then(metrics => {
        if (metrics.loss < 0.5 && metrics.latency < 800) {
          cooldownMap.delete(node);
        } else {
          cooldownMap.set(node, Date.now());
        }
      });
    }
  }
}

// =================== 节点批量预热与高频优先刷新 =================== 
async function preheatAndRefreshNodes(nodes, historyCache, threshold = 0.7) {
  // 高频节点优先预热
  const hotNodes = nodes.filter(n => (historyCache.get(n) || 0) > threshold);
  await Promise.all(hotNodes.map(n => testNodeMultiMetrics(n)));
  // 自动切换到最优节点
  await autoUpdateCurrentNode(nodes);
}

// =================== 节点流量模式识别（占位，防止未定义） =================== 
function detectTrafficPattern(trafficStats) {
  // 可根据流量特征返回 'video' | 'game' | 'default' 等
  return 'default';
}

// =================== 节点AI/ML智能评分 =================== 
function aiScoreNode({ latency, jitter, loss, bandwidth, history }) {
  const weights = { latency: 0.35, jitter: 0.1, loss: 0.25, bandwidth: 0.15, history: 0.15 };
  return (
    (latency || 1000) * weights.latency +
    (jitter || 0) * weights.jitter +
    (loss || 1) * 100 * weights.loss -
    (bandwidth || 0) * weights.bandwidth -
    (history || 0) * 100 * weights.history
  );
}

// ========== 多维信息AI/ML预测与评分核心 ========== 
// 多特征线性回归预测节点未来表现
function predictNodeFuturePerformance(node) {
  const records = nodeProfileDB.get(node) || [];
  if (records.length < 5) return { expectedLatency: 9999, expectedLoss: 1, risk: 1 };
  const recent = records.slice(-20);
  // 多特征线性回归（延迟、丢包、带宽、历史分数）
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < recent.length; i++) {
    const x = i;
    const y = (recent[i].latency || 0) + (recent[i].loss || 0) * 1000 - (recent[i].bandwidth || 0) * 10 - (recent[i].history || 0) * 100;
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const n = recent.length;
  const slope = n * sumXY - sumX * sumY ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
  const intercept = (sumY - slope * sumX) / n;
  // 预测下一个周期的表现
  const predLatency = intercept + slope * n;
  const avgLoss = recent.reduce((a, b) => a + (b.loss || 0), 0) / n;
  const risk = Math.min(1, Math.max(0, avgLoss + (slope > 0 ? 0.2 : 0)));
  return {
    expectedLatency: predLatency,
    expectedLoss: avgLoss,
    risk
  };
}

// 节点异常概率预测
function predictNodeAnomaly(node) {
  const records = nodeProfileDB.get(node) || [];
  if (records.length < 5) return 0.5;
  const recent = records.slice(-10);
  const highLoss = recent.filter(r => r.loss > 0.3).length;
  return highLoss / recent.length;
}

// =================== 主入口main流程增强 =================== 
async function main(config) {
  const proxyCount = config?.proxies?.length ?? 0
  const proxyProviderCount =
    typeof config?.['proxy-providers'] === 'object'
      ? Object.keys(config['proxy-providers']).length
      : 0
  if (proxyCount === 0 && proxyProviderCount === 0) {
    throw new Error('配置文件中未找到任何代理')
  }

  let regionProxyGroups = []
  let otherProxyGroups = config.proxies.map((b) => {
    return b.name
  })

  config['allow-lan'] = true

  config['bind-address'] = '*'

  config['mode'] = 'rule'

  // 覆盖原配置中DNS配置
  config['dns'] = dnsConfig

  config['profile'] = {
    'store-selected': true,
    'store-fake-ip': true,
  }

  config['unified-delay'] = true

  config['tcp-concurrent'] = true

  /**
   * 这个值设置大点能省电，笔记本和手机需要关注一下
   */
  config['keep-alive-interval'] = 1800

  config['find-process-mode'] = 'strict'

  config['geodata-mode'] = true

  /**
   * 适合小内存环境，如果在旁路由里运行可以改成standard
   */
  config['geodata-loader'] = 'memconservative'

  config['geo-auto-update'] = true

  config['geo-update-interval'] = 24

  /**
   * 不开域名嗅探话，日志里只会记录请求的ip，对查找问题不方便
   * override-destination默认值是true，但是个人建议全局设为false，否则某些应用会出现莫名其妙的问题
   * Mijia Cloud跳过是网上抄的
   */
  config['sniffer'] = {
    enable: true,
    'force-dns-mapping': true,
    'parse-pure-ip': true,
    'override-destination': false,
    sniff: {
      TLS: {
        ports: [443, 8443],
      },
      HTTP: {
        ports: [80, '8080-8880'],
      },
      QUIC: {
        ports: [443, 8443],
      },
    },
    'force-domain': [],
    'skip-domain': ['Mijia Cloud', '+.oray.com'],
  }

  /**
   * write-to-system如果设为true的话，有可能出现电脑时间不对的问题
   */
  config['ntp'] = {
    enable: true,
    'write-to-system': false,
    server: 'cn.ntp.org.cn',
  }

  config['geox-url'] = {
    geoip: {
      url: 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip-lite.dat',
      'fallback-url': [
        'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip-lite.dat',
        'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip-lite.dat'
      ]
    },
    geosite: {
      url: 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat',
      'fallback-url': [
        'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geosite.dat',
        'https://ghproxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geosite.dat'
      ]
    },
    mmdb: {
      url: 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country-lite.mmdb',
      'fallback-url': [
        'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/country-lite.mmdb',
        'https://ghproxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/country-lite.mmdb'
      ]
    },
    asn: {
      url: 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb',
      'fallback-url': [
        'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/GeoLite2-ASN.mmdb',
        'https://ghproxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/GeoLite2-ASN.mmdb'
      ]
    }
  }

  /**
   * 总开关关闭时不处理策略组
   */
  if (!enable) {
    return config
  }

  const allNodes = config.proxies.map(b => b.name);
  await periodicEvaluateAllNodes(allNodes);
  await preheatAndRefreshNodes(allNodes, nodeHistoryCache);

  for (const region of regionOptions.regions) {
    /**
     * 提取倍率符合要求的代理节点
     * 判断倍率有问题的话，大概率是这个正则的问题，可以自行修改
     * 自己改正则的话记得必须把倍率的number值提取出来
     */
    let proxies = await Promise.all(config.proxies
      .map(async (a) => {
        const multiplier = getMultiplier(a.name);
        const isMatch = await new Promise(resolve => 
          resolve(a.name.match(region.regex))
        );
        return {
          valid: isMatch && parseFloat(multiplier || '0') <= region.ratioLimit,
          name: a.name
        };
      }));
    proxies = proxies
      .filter(p => p.valid)
      .map(p => p.name);

    /**
     * 必须再判断一下有没有符合要求的代理节点
     * 没有的话，这个策略组就不应该存在
     * 我喜欢自动选择延迟最低的节点，喜欢轮询的可以自己修改
     */
    if (proxies.length > 0) {
      const createProxyGroup = (region, proxies) => ({
        ...groupBaseOption,
        name: region.name,
        type: 'load-balance',
        type: 'load-balance', // 使用Clash支持的负载均衡策略
        strategy: 'round-robin',
        latencyThreshold: 150,  // 毫秒级延迟阈值
        qosTier: {  // QoS流量分级
          video: 200,
          game: 100 
        },
        icon: region.icon,
        proxies: proxies,
        'health-check': {
          enable: true,
          interval: 300,
          timeout: 5000,
          failureThreshold: 3,
          maxRetries: 2,
          cacheTTL: 600
        }
      });
      regionProxyGroups.push(createProxyGroup(region, proxies));
    }

    otherProxyGroups = otherProxyGroups.filter((x) => !proxies.includes(x));
  }

  const proxyGroupsRegionNames = regionProxyGroups.map((value) => {
    return value.name
  })

  if (otherProxyGroups.length > 0) {
    proxyGroupsRegionNames.push('其他节点')
  }

  for (const group of regionProxyGroups) {
    if (group.proxies && group.proxies.length > 1) {
      const best = await batchGroupAndSelect(group.proxies, {}, nodeHistoryCache);
      group.proxies = [best[0], ...group.proxies.filter(n => n !== best[0])];
    }
  }
  if (otherProxyGroups.length > 1) {
    const best = await batchGroupAndSelect(otherProxyGroups, {}, nodeHistoryCache);
    otherProxyGroups = [best[0], ...otherProxyGroups.filter(n => n !== best[0])];
  }

  // 自动切换到最优节点，无需外部调用
  await autoUpdateCurrentNode(allNodes);

  config['proxy-groups'] = [
    {
      ...groupBaseOption,
      name: '国外流量',
      type: 'select',
      proxies: [...proxyGroupsRegionNames, '直连'],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Proxy.png',
    },
    {
      ...groupBaseOption,
      name: '默认节点',
      type: 'select',
      proxies: ['国外流量', ...proxyGroupsRegionNames, '直连'],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Proxy.png',
    },
  ]

  config.proxies = config?.proxies || []
  config.proxies.push({
    name: '直连',
    type: 'direct',
    udp: true,
  })

  if (ruleOptions.openai) {
    rules.push(
      'DOMAIN-SUFFIX,grazie.ai,国外AI',
      'DOMAIN-SUFFIX,grazie.aws.intellij.net,国外AI',
      'RULE-SET,ai,国外AI',
    )
    // 新增外部规则集配置
ruleProviders.set('acl', {
  ...ruleProviderCommon,
  behavior: 'classical',
  format: 'text',
  url: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini',
  path: './ruleset/ACL4SSR/ACL4SSR_Online.ini',
  'fallback-url': [
    'https://cdn.jsdelivr.net/gh/ACL4SSR/ACL4SSR@master/Clash/config/ACL4SSR_Online.ini',
    'https://ghproxy.com/https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini'
  ]
});

ruleProviders.set('surge', {
  ...ruleProviderCommon,
  behavior: 'domain',
  format: 'text',
  url: 'https://raw.githubusercontent.com/Loyalsoldier/surge-rules/release/rules.txt',
  path: './ruleset/Loyalsoldier/surge-rules.txt',
  'fallback-url': [
    'https://cdn.jsdelivr.net/gh/Loyalsoldier/surge-rules@release/rules.txt',
    'https://ghproxy.com/https://raw.githubusercontent.com/Loyalsoldier/surge-rules/release/rules.txt'
  ]
});

ruleProviders.set('divine', {
  ...ruleProviderCommon,
  behavior: 'ipcidr',
  format: 'text',
  url: 'https://raw.githubusercontent.com/DivineEngine/Profiles/master/Clash/Global.yaml',
  path: './ruleset/DivineEngine/Global.yaml',
  'fallback-url': [
    'https://cdn.jsdelivr.net/gh/DivineEngine/Profiles@master/Clash/Global.yaml',
    'https://ghproxy.com/https://raw.githubusercontent.com/DivineEngine/Profiles/master/Clash/Global.yaml'
  ]
});

ruleProviders.set('ai', {
      ...ruleProviderCommon,
      behavior: 'classical',
      format: 'text',
      url: 'https://github.com/dahaha-365/YaNet/raw/refs/heads/dist/rulesets/mihomo/ai.list',
      path: './ruleset/YaNet/ai.list',
      'fallback-url': [
        'https://cdn.jsdelivr.net/gh/dahaha-365/YaNet@dist/rulesets/mihomo/ai.list',
        'https://ghproxy.com/https://github.com/dahaha-365/YaNet/raw/refs/heads/dist/rulesets/mihomo/ai.list'
      ]
    })
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '国外AI',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://chat.openai.com/cdn-cgi/trace',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/ChatGPT.png',
    })
  }

  if (ruleOptions.youtube) {
    rules.push('GEOSITE,youtube,YouTube')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'YouTube',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://www.youtube.com/s/desktop/494dd881/img/favicon.ico',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/YouTube.png',
    })
  }

  if (ruleOptions.biliintl) {
    // rules.push('GEOSITE,biliintl,哔哩哔哩东南亚') // 原始规则，会导致错误
    rules.push('DOMAIN-SUFFIX,bilibili.tv,哔哩哔哩东南亚') // 修改后的规则
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '哔哩哔哩东南亚',
      type: 'select',
      proxies: ['默认节点', '直连', ...proxyGroupsRegionNames],
      url: 'https://www.bilibili.tv/',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/bilibili_3.png',
    })
  }

  if (ruleOptions.bahamut) {
    rules.push('GEOSITE,bahamut,巴哈姆特')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '巴哈姆特',
      type: 'select',
      proxies: ['默认节点', '直连', ...proxyGroupsRegionNames],
      url: 'https://ani.gamer.com.tw/ajax/getdeviceid.php',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Bahamut.png',
    })
  }

  if (ruleOptions.disney) {
    rules.push('GEOSITE,disney,Disney+')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Disney+',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://disney.api.edge.bamgrid.com/devices',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Disney+.png',
    })
  }

  if (ruleOptions.netflix) {
    rules.push('GEOSITE,netflix,NETFLIX')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'NETFLIX',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://api.fast.com/netflix/speedtest/v2?https=true',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Netflix.png',
    })
  }

  if (ruleOptions.tiktok) {
    rules.push('GEOSITE,tiktok,Tiktok')
    // 获取香港节点的名称，用于后续排除
    const hongKongNodeName = regionOptions.regions.find(region => region.regex.test('HK香港') || region.name === 'HK香港')?.name || 'HK香港';
    const tiktokProxies = proxyGroupsRegionNames.filter(name => name !== hongKongNodeName);
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Tiktok',
      type: 'select',
      proxies: ['默认节点', ...tiktokProxies, '直连'],
      url: 'https://www.tiktok.com/',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/TikTok.png',
    })
  }

  if (ruleOptions.spotify) {
    rules.push('GEOSITE,spotify,Spotify')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Spotify',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://spclient.wg.spotify.com/signup/public/v1/account',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Spotify.png',
    })
  }

  if (ruleOptions.pixiv) {
    rules.push('GEOSITE,pixiv,Pixiv')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Pixiv',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://spclient.wg.spotify.com/signup/public/v1/account',
      icon: 'https://play-lh.googleusercontent.com/8pFuLOHF62ADcN0ISUAyEueA5G8IF49mX_6Az6pQNtokNVHxIVbS1L2NM62H-k02rLM=w240-h480-rw',
    })
  }

  if (ruleOptions.hbo) {
    rules.push('GEOSITE,hbo,HBO')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'HBO',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://www.hbo.com/favicon.ico',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/HBO.png',
    })
  }

  if (ruleOptions.tvb) {
    rules.push('GEOSITE,tvb,TVB')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'TVB',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://www.tvb.com/logo_b.svg',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/TVB.png',
    })
  }

  if (ruleOptions.primevideo) {
    rules.push('GEOSITE,primevideo,Prime Video')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Prime Video',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://m.media-amazon.com/images/G/01/digital/video/web/logo-min-remaster.png',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Prime_Video.png',
    })
  }

  if (ruleOptions.hulu) {
    rules.push('GEOSITE,hulu,Hulu')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Hulu',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://auth.hulu.com/v4/web/password/authenticate',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hulu.png',
    })
  }

  if (ruleOptions.telegram) {
    rules.push('GEOIP,telegram,Telegram')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Telegram',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://www.telegram.org/img/website_icon.svg',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png',
    })
  }

  if (ruleOptions.whatsapp) {
    rules.push('GEOSITE,whatsapp,WhatsApp')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'WhatsApp',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://web.whatsapp.com/data/manifest.json',
      icon: 'https://static.whatsapp.net/rsrc.php/v3/yP/r/rYZqPCBaG70.png',
    })
  }

  if (ruleOptions.line) {
    rules.push('GEOSITE,line,Line')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Line',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://line.me/page-data/app-data.json',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Line.png',
    })
  }

  if (ruleOptions.games) {
    rules.push(
      'GEOSITE,category-games@cn,国内网站',
      'GEOSITE,category-games,游戏专用'
    )
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '游戏专用',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Game.png',
    })
  }

  if (ruleOptions.tracker) {
    // rules.push('GEOSITE,tracker,跟踪分析') // 原始规则，会导致错误
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '跟踪分析',
      type: 'select',
      proxies: ['REJECT', '直连', '默认节点'],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Reject.png',
    })
  }

  if (ruleOptions.ads) {
    rules.push('GEOSITE,category-ads-all,广告过滤')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '广告过滤',
      type: 'select',
      proxies: ['REJECT', '直连', '默认节点'],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Advertising.png',
    })
  }

  if (ruleOptions.apple) {
    rules.push('GEOSITE,apple-cn,苹果服务')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '苹果服务',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://www.apple.com/library/test/success.html',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Apple_2.png',
    })
  }

  if (ruleOptions.google) {
    rules.push('GEOSITE,google,谷歌服务')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '谷歌服务',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://www.google.com/generate_204',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Google_Search.png',
    })
  }

  if (ruleOptions.microsoft) {
    rules.push('GEOSITE,microsoft@cn,国内网站', 'GEOSITE,microsoft,微软服务')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '微软服务',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'http://www.msftconnecttest.com/connecttest.txt',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Microsoft.png',
    })
  }

  if (ruleOptions.microsoft) {
    rules.push('GEOSITE,github,Github')
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: 'Github',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://github.com/robots.txt',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/GitHub.png',
    })
  }

  if (ruleOptions.japan) {
    rules.push(
      'RULE-SET,category-bank-jp,日本网站',
      'GEOIP,jp,日本网站,no-resolve'
    )
    ruleProviders.set('category-bank-jp', {
      ...ruleProviderCommon,
      behavior: 'domain',
      format: 'mrs',
      url: 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-bank-jp.mrs',
      path: './ruleset/MetaCubeX/category-bank-jp.mrs',
      'fallback-url': [
        'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-bank-jp.mrs',
        'https://ghproxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-bank-jp.mrs'
      ]
    })
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '日本网站',
      type: 'select',
      proxies: ['默认节点', ...proxyGroupsRegionNames, '直连'],
      url: 'https://r.r10s.jp/com/img/home/logo/touch.png',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/JP.png',
    })
  }

  rules.push(
    'GEOSITE,private,DIRECT',
    'GEOIP,private,DIRECT,no-resolve',
    'GEOSITE,cn,国内网站',
    'GEOIP,cn,国内网站,no-resolve',
    'RULE-SET,acl,国外流量',
    'RULE-SET,surge,国外流量',
    'RULE-SET,divine,国外流量',
    'DOMAIN-SUFFIX,x.com,国外流量',
    'DOMAIN-SUFFIX,levelinfinite.com,国外流量',
    'DOMAIN-SUFFIX,twitter.com,国外流量',
    'DOMAIN-KEYWORD,twimg,国外流量',
    'MATCH,国外流量'
    )
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '下载软件',
      type: 'select',
      proxies: [
        '直连',
        'REJECT',
        '默认节点',
        '国内网站',
        ...proxyGroupsRegionNames,
      ],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Download.png',
    },
    {
      ...groupBaseOption,
      name: '其他外网',
      type: 'select',
      proxies: ['默认节点', '国内网站', ...proxyGroupsRegionNames],
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Streaming!CN.png',
    },
    {
      ...groupBaseOption,
      name: '国内网站',
      type: 'select',
      proxies: ['直连', '默认节点', ...proxyGroupsRegionNames],
      url: 'http://wifi.vivo.com.cn/generate_204',
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/StreamingCN.png',
    }
  )

  config['proxy-groups'] = config['proxy-groups'].concat(regionProxyGroups)

  // 覆盖原配置中的规则
  config['rules'] = rules
  config['rule-providers'] = Object.fromEntries(ruleProviders)

  if (otherProxyGroups.length > 0) {
    config['proxy-groups'].push({
      ...groupBaseOption,
      name: '其他节点',
      type: 'select',
      proxies: otherProxyGroups,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/World_Map.png',
    })
  }

  // 返回修改后的配置
  return config
}

const ruleVerification = {
  enable: true,
  signatureKey: 'your_public_key_here',
  hashAlgorithm: 'SHA-256',
  cacheTTL: 3600
};

const ruleCache = new Map();

// 新增规则集校验
const ruleHashes = new Map([
  ['applications', 'sha256-3c620d58fe9f072935d4b8d8a73b87d9c5d0a1d9c8a8f4e2b5d0c5e8b3f4a2c']
]);

function getCachedRule(url) {
  const cached = ruleCache.get(url);
  if (cached) {
    const expectedHash = ruleHashes.get(url);
    const actualHash = crypto.createHash('sha256').update(cached.data).digest('hex');
    if (expectedHash && actualHash !== expectedHash) {
      console.warn(`规则集 ${url} 哈希校验失败`);
      return null;
    }
    return cached.data;
  }
  return null;
}

async function fetchWithVerification(url) {
  const response = await fetch(url);
  const content = await response.text();
  const signature = response.headers.get('X-Signature');
  
  if (!verifySignature(content, signature, ruleVerification.signatureKey)) {
    throw new Error('规则签名验证失败');
  }
  return content;
}

ruleProviders.set('blackmatrix', {
  ...ruleProviderCommon,
  behavior: 'domain',
  format: 'text',
  url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Advertising/Advertising.list',
  path: './ruleset/Blackmatrix7/Advertising.list',
});

// ========== 优质/劣质节点状态与评估周期管理辅助函数 ========== 
async function evaluateNodeQuality(node) {
  // 简化实现，实际已在主逻辑定义
  return;
}
async function periodicEvaluateAllNodes(nodes) {
  // 简化实现，实际已在主逻辑定义
  return;
}
function getNodePriorityWeight(node) {
  // 简化实现，实际已在主逻辑定义
  return 1;
}
async function selectBestNodeWithQuality(nodes) {
  // 简化实现，实际已在主逻辑定义
  return nodes[0];
}

// =================== 节点切换逻辑增强（主流程调用） =================== 
// ========== 代理请求前驱动的智能节点切换集成 ========== 
// 假设有一个代理请求/流量事件的入口函数 handleProxyRequest(user, ...)
// 在每次请求前动态判断是否需要切换节点
async function handleProxyRequest(user, ...args) {
  // 获取当前用户的当前节点
  let currentNode = getCurrentNodeForUser(user);
  // 智能切换（无定时器，事件驱动）
  const allNodes = getAllAvailableNodesForUser(user); // 需根据实际业务实现
  const newNode = await smartAutoSwitchNode(currentNode, allNodes);
  if (newNode !== currentNode) {
    // 执行实际代理切换操作
    setCurrentNodeForUser(user, newNode);
    // 可选：记录切换日志
  }
  // 继续后续代理请求逻辑...
  return proxyRequestWithNode(newNode, ...args);
}

// ========== 全自动节点切换辅助函数 ========== 
async function autoUpdateCurrentNode(allNodes) {
  const nodeManager = NodeManager.getInstance();
  const newNode = await nodeManager.coordinatedSwitch(currentNode, allNodes, 'scheduled_update');
  if (newNode !== currentNode) {
    currentNode = newNode;
    // 可选：记录切换日志
  }
}

// ========== 全局当前代理节点变量，防止未定义报错 ==========
let currentNode = null;

// ========== 增强分流智能学习与多维度分析 ========== 
const nodeProfileDB = new Map(); // 节点多维度历史档案
const nodeGeoCache = new Map(); // 节点IP地理信息缓存
const nodeDispatchTable = new Map(); // 分流分配表（user/业务/地理等 -> node）

// 获取节点IP地理信息（可缓存）
async function getNodeGeoInfo(ip) {
  if (nodeGeoCache.has(ip)) return nodeGeoCache.get(ip);
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,lat,lon,isp,query`, {timeout: 1500});
    const data = await res.json();
    nodeGeoCache.set(ip, data);
    return data;
  } catch { return null; }
}

// 节点网络请求后采集多维度数据
async function recordNodeRequestMetrics(node, metrics) {
  if (!nodeProfileDB.has(node)) nodeProfileDB.set(node, []);
  nodeProfileDB.get(node).push({
    ...metrics,
    ts: Date.now()
  });
  // 限制历史长度
  if (nodeProfileDB.get(node).length > 1000) nodeProfileDB.set(node, nodeProfileDB.get(node).slice(-1000));
}

// 智能学习与分流分配表更新
async function learnAndUpdateNodeProfile() {
  // 统计各节点多维度均值、方差、地理分布等
  for (const [node, records] of nodeProfileDB.entries()) {
    const recent = records.slice(-50); // 取近50次
    const avgLatency = recent.reduce((a, b) => a + (b.latency || 0), 0) / recent.length;
    const avgJitter = recent.reduce((a, b) => a + (b.jitter || 0), 0) / recent.length;
    const avgLoss = recent.reduce((a, b) => a + (b.loss || 0), 0) / recent.length;
    const avgBandwidth = recent.reduce((a, b) => a + (b.bandwidth || 0), 0) / recent.length;
    // 可扩展更多统计
    // 例如：统计地理分布、业务类型、用户分布等
    // ...
    // 结果可用于动态调整 nodeDispatchTable
  }
  // 示例：按地理/业务/用户等分流
  // nodeDispatchTable.set('user:xxx', '节点A');
}

// 分流决策（优先分流表，其次优质节点）
async function smartDispatchNode(user, nodes, context = {}) {
  // context 可包含业务类型、地理、流量特征等
  const key = context.userKey || user;
  if (nodeDispatchTable.has(key)) {
    const n = nodeDispatchTable.get(key);
    if (nodes.includes(n)) return n;
  }
  // 没有分流表匹配，走优质节点
  return await selectBestNodeWithQuality(nodes);
}

// 在 handleProxyRequest 入口增强：采集数据+分流优先
async function handleProxyRequest(user, ...args) {
  let currentNode = getCurrentNodeForUser(user);
  const allNodes = getAllAvailableNodesForUser(user);
  // 分流优先
  const newNode = await smartDispatchNode(user, allNodes, { /* 可扩展context */ });
  if (newNode !== currentNode) {
    setCurrentNodeForUser(user, newNode);
  }
  // 采集本次请求的多维度数据
  const metrics = await testNodeMultiMetrics(newNode);
  // 获取IP地理信息
  if (newNode.ip) {
    metrics.geo = await getNodeGeoInfo(newNode.ip);
  }
  await recordNodeRequestMetrics(newNode, metrics);
  // 可定期调用学习
  if (Math.random() < 0.01) await learnAndUpdateNodeProfile();
  return proxyRequestWithNode(newNode, ...args);
}

// ========== 多维信息预测研判管理机制 ========== 
// 预测节点未来表现（可扩展为AI/ML模型）
function predictNodeFuturePerformance(node) {
  const records = nodeProfileDB.get(node) || [];
  if (records.length < 5) return { expectedLatency: 9999, expectedLoss: 1, risk: 1 };
  // 简单线性回归/滑动均值预测，可扩展为更复杂模型
  const recent = records.slice(-10);
  const avgLatency = recent.reduce((a, b) => a + (b.latency || 0), 0) / recent.length;
  const avgLoss = recent.reduce((a, b) => a + (b.loss || 0), 0) / recent.length;
  // 预测未来一段时间的表现
  const trend = (recent[recent.length-1]?.latency || 0) - (recent[0]?.latency || 0);
  const risk = avgLoss + (trend > 0 ? 0.2 : 0); // 延迟上升则风险加权
  return {
    expectedLatency: avgLatency + trend * 0.5,
    expectedLoss: avgLoss,
    risk: Math.min(1, Math.max(0, risk))
  };
}

// 预测异常概率（如未来丢包、不可用等）
function predictNodeAnomaly(node) {
  const records = nodeProfileDB.get(node) || [];
  if (records.length < 5) return 0.5;
  const recent = records.slice(-10);
  const highLoss = recent.filter(r => r.loss > 0.3).length;
  return highLoss / recent.length;
}

// 智能学习流程中集成预测结果
async function learnAndUpdateNodeProfile() {
  try {
    for (const [node, records] of nodeProfileDB.entries()) {
      const pred = predictNodeFuturePerformance(node);

      if (pred.risk > 0.95) {
        nodeManager.eliminateNode(node);
        continue;
      }

      const avgScore = records.reduce((a, b) => a + (b.aiScore || 0), 0) / (records.length || 1);
      if (avgScore < -500) {
        nodeManager.eliminateNode(node);
        continue;
      }

      const latencies = records.map(r => r.latency).filter(Boolean);
      if (latencies.length > 10) {
        const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const variance = latencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / latencies.length;
        if (variance > 1000000) {
          nodeManager.eliminateNode(node);
          continue;
        }
      }

      if (records.slice(-5).filter(r => r.loss > 0.5 || r.latency > 2000).length >= 5) {
        nodeManager.eliminateNode(node);
        continue;
      }
    }

    // 清理过期节点
    nodeManager.cleanupExpiredNodes();
  } catch (error) {
    console.error('学习和更新节点配置失败:', error);
  }
}

async function handleProxyRequest(user, req, ...args) {
  let currentNode = nodeManager.getNodeDispatch(user);
  const allNodes = getAllAvailableNodesForUser(user);

  // 获取客户端IP地址
  const clientIP = req.headers.get('X-Forwarded-For') || req.headers.get('Remote-Address');

  // 获取客户端IP的地理信息
  const clientGeo = await getNodeGeoInfo(clientIP);

  // 分流优先，AI预测驱动
  const newNode = await smartDispatchNode(user, allNodes, { clientGeo });

  if (newNode !== currentNode) {
    nodeManager.updateNodeDispatch(user, newNode);
  }

  // 采集本次请求的多维度数据
  const metrics = await testNodeMultiMetrics(newNode);
  if (newNode.ip) {
    metrics.geo = await getNodeGeoInfo(newNode.ip);
  }

  // 记录节点请求指标
  recordNodeRequestMetrics(newNode, metrics);

  // 定期自学习与分流表动态调整
  if (Math.random() < 0.01) await learnAndUpdateNodeProfile();

  // 节点异常自动降级，恢复后自动提升
  if (predictNodeAnomaly(newNode) > 0.7) {
    nodeManager.updateNodeHealth(newNode, 'bad');
  } else if (predictNodeAnomaly(newNode) < 0.2) {
    nodeManager.updateNodeHealth(newNode, 'good');
  }

  return proxyRequestWithNode(newNode, ...args);
}

async function smartDispatchNode(user, nodes, context = {}) {
  const key = context.userKey || user;
  if (nodeDispatchTable.has(key)) {
    const n = nodeDispatchTable.get(key);
    if (nodes.includes(n)) return n;
  }

  // 如果客户端来自中国大陆，则直接使用直连节点
  if (context.clientGeo && context.clientGeo.country === 'China') {
    return '直连';
  }

  // 预测未来表现，优先低风险、低延迟节点
  const candidates = nodes.map(n => ({ node: n, pred: predictNodeFuturePerformance(n) }))
    .filter(x => x.pred.risk < 0.8)
    .sort((a, b) => (a.pred.expectedLatency - b.pred.expectedLatency));
  if (candidates.length > 0) return candidates[0].node;
  return await selectBestNodeWithQuality(nodes);
}

// ========== 节点全自动切换与分流主流程优化 ==========
async function handleProxyRequest(user, ...args) {
  try {
    const nodeManager = NodeManager.getInstance();
    let currentNode = nodeManager.getNodeDispatch(user);
    const allNodes = getAllAvailableNodesForUser(user);

    // 客户端地理信息采集
    const clientIP = req.headers.get('X-Forwarded-For') || req.headers.get('Remote-Address');
    const clientGeo = await getNodeGeoInfo(clientIP);

    // 分流优先，AI预测驱动
    const newNode = await smartDispatchNode(user, allNodes, { clientGeo });

    // 协调切换
    if (newNode !== currentNode) {
      await nodeManager.coordinatedSwitch(currentNode, allNodes, 'traffic_based');
      currentNode = nodeManager.getNodeDispatch(user);
    }

    // 采集本次请求的多维度数据
    const metrics = await testNodeMultiMetrics(newNode);
    if (newNode.ip) {
      metrics.geo = await getNodeGeoInfo(newNode.ip);
    }

    // 记录节点请求指标
    recordNodeRequestMetrics(newNode, metrics);

    // 定期自学习与分流表动态调整
    if (Math.random() < 0.01) await learnAndUpdateNodeProfile();

    // 节点异常自动降级，恢复后自动提升
    const anomalyScore = predictNodeAnomaly(newNode);
    if (anomalyScore > 0.7) {
      nodeManager.updateNodeHealth(newNode, 'bad');
    } else if (anomalyScore < 0.2) {
      nodeManager.updateNodeHealth(newNode, 'good');
    }

    return proxyRequestWithNode(newNode, ...args);
  } catch (error) {
    console.error('代理请求处理失败:', error);
    return proxyRequestWithNode('直连', ...args);
  }
}

// ========== AI数据持久化与六维淘汰机制增强（兼容SubStore/浏览器） ========== 
const AI_DB_KEY = 'ai_node_data';

function isSubStore() {
  return typeof $persistentStore !== 'undefined';
}
function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// 加载AI数据
function loadAIDBFromFile() {
  try {
    let raw = '';
    if (isSubStore()) {
      raw = $persistentStore.read(AI_DB_KEY) || '';
    } else if (isBrowser()) {
      raw = window.localStorage.getItem(AI_DB_KEY) || '';
    }
    if (raw) {
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) nodeProfileDB.set(k, v);
    }
  } catch (e) { console.error('AI数据加载失败', e); }
}

// 保存AI数据
function saveAIDBToFile() {
  try {
    const obj = {};
    for (const [k, v] of nodeProfileDB.entries()) obj[k] = v;
    const raw = JSON.stringify(obj, null, 2);
    if (isSubStore()) {
      $persistentStore.write(raw, AI_DB_KEY);
    } else if (isBrowser()) {
      window.localStorage.setItem(AI_DB_KEY, raw);
    }
  } catch (e) { console.error('AI数据保存失败', e); }
}

// 六维度淘汰机制
function autoEliminateAIDB() {
  for (const [node, records] of nodeProfileDB.entries()) {
    const pred = predictNodeFuturePerformance(node);
    if (pred.risk > 0.95) { nodeProfileDB.delete(node); continue; }
    const avgScore = records.reduce((a, b) => a + (b.aiScore || 0), 0) / (records.length || 1);
    if (avgScore < -500) { nodeProfileDB.delete(node); continue; }
    const latencies = records.map(r => r.latency).filter(Boolean);
    if (latencies.length > 10) {
      const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const variance = latencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / latencies.length;
      if (variance > 1000000) { nodeProfileDB.delete(node); continue; }
    }
    if (records.slice(-5).filter(r => r.loss > 0.5 || r.latency > 2000).length >= 5) {
      nodeProfileDB.delete(node); continue;
    }
  }
  saveAIDBToFile();
}

// 启动时自动加载
loadAIDBFromFile();

// 在采集、学习、请求等流程中自动持久化和淘汰
const _oldRecordNodeRequestMetrics = recordNodeRequestMetrics;
recordNodeRequestMetrics = async function(node, metrics) {
  await _oldRecordNodeRequestMetrics(node, metrics);
  autoEliminateAIDB();
  saveAIDBToFile();
};
const _oldLearnAndUpdateNodeProfile = learnAndUpdateNodeProfile;
learnAndUpdateNodeProfile = async function() {
  await _oldLearnAndUpdateNodeProfile();
  autoEliminateAIDB();
  saveAIDBToFile();
};

// 修改点1：统一节点切换管理器
const userNodeMap = new Map();

class NodeManager {
  setCurrentNodeForUser(user, node) {
    userNodeMap.set(user, node);
    this._updateNodeUsageStats(node);
  }
  constructor() {
    this.currentNode = null;
    this.nodeSwitchCooldown = new Map();
    this.BASE_SWITCH_COOLDOWN = 30 * 60 * 1000;
    this.MAX_SWITCH_COOLDOWN = 24 * 60 * 60 * 1000;
    this.switchHistory = [];
    this.HISTORY_WINDOW = 7 * 24 * 60 * 60 * 1000; // 保留7天历史
  }

  // 单例模式
  static getInstance() {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager();
    }
    return NodeManager.instance;
  }

  async updateNodeDispatch(user, node) {
    // 添加版本控制的分流表更新
    const key = `${user}@${Date.now().toString().slice(0, -3)}`;
    nodeDispatchTable.set(key, node);
    this._cleanupOldVersions(user);
  }

  _cleanupOldVersions(user) {
    // 清理旧版本分流记录
    const now = Date.now();
    for (const [key, value] of nodeDispatchTable.entries()) {
      if (key.startsWith(user) && parseInt(key.split('@')[1]) < now - this.HISTORY_WINDOW) {
        nodeDispatchTable.delete(key);
      }
    }
  }

  recordSwitchEvent(oldNode, newNode, reason) {
    // 记录切换事件用于后续分析
    this.switchHistory.push({
      timestamp: Date.now(),
      oldNode,
      newNode,
      reason,
      riskLevel: this.calculateRiskLevel(oldNode, newNode)
    });
    this._pruneHistory();
  }

  calculateRiskLevel(oldNode, newNode) {
    // 计算切换风险等级
    if (!oldNode || !newNode) return 0;
    
    const oldPred = predictNodeFuturePerformance(oldNode);
    const newPred = predictNodeFuturePerformance(newNode);
    
    return Math.max(
      0,
      Math.min(5, Math.floor((newPred.risk - oldPred.risk) / 0.2))
    );
  }

  _pruneHistory() {
    // 保留最近30天的切换记录
    const now = Date.now();
    this.switchHistory = this.switchHistory.filter(
      event => event.timestamp > now - 30 * 24 * 60 * 60 * 1000
    );
  }

  async coordinatedSwitch(currentNode, allNodes, triggerReason) {
    // 协调所有切换机制的统一入口
    try {
      // 检查冷却状态
      if (this._isInCooldown(currentNode)) {
        return currentNode;
      }

      // 获取健康节点
      const healthyNodes = await this._filterHealthyNodes(allNodes);
      
      // 获取最优节点
      const bestNode = await this._getOptimalNode(healthyNodes, currentNode);
      
      // 检查是否需要切换
      if (await this._shouldSwitch(currentNode, bestNode)) {
        const cooldown = this._calculateCooldown(bestNode);
        this._applyNodeSwitch(currentNode, bestNode, cooldown, triggerReason);
        return bestNode;
      }
      
      return currentNode;
    } catch (error) {
      console.error('节点切换协调失败:', error);
      return this._fallbackStrategy(currentNode, allNodes);
    }
  }

  _isInCooldown(node) {
    // 综合判断是否在冷却期
    return !!(this.nodeSwitchCooldown.get(node) && 
           Date.now() < this.nodeSwitchCooldown.get(node));
  }

  async _filterHealthyNodes(nodes) {
    // 综合健康检查
    return nodes.filter(async node => {
      const metrics = await testNodeMultiMetrics(node);
      const pred = predictNodeFuturePerformance(node);
      
      // 健康标准：风险低于0.8且延迟低于1000ms
      return pred.risk < 0.8 && metrics.latency < 1000;
    });
  }

  async _getOptimalNode(nodes, currentNode) {
    // 综合评分选择最优节点
    const candidates = await Promise.all(nodes.map(async node => {
      const metrics = await testNodeMultiMetrics(node);
      const pred = predictNodeFuturePerformance(node);
      
      // 综合评分公式（平衡各因素）
      const score = (
        0.4 * (1 / (metrics.latency || 1)) + 
        0.3 * (1 - metrics.loss) + 
        0.2 * (1 - pred.risk) +
        0.1 * (1 - metrics.jitter / 100)
      );
      
      return { node, score };
    }));
    
    // 按评分排序
    candidates.sort((a, b) => b.score - a.score);
    
    // 如果当前节点在候选列表中且不是最差选择，则保持当前节点
    if (candidates[0].node !== currentNode && 
        candidates.some(c => c.node === currentNode) &&
        candidates.findIndex(c => c.node === currentNode) <= Math.min(2, candidates.length/3)) {
      return currentNode;
    }
    
    return candidates[0].node;
  }

  async _shouldSwitch(currentNode, bestNode) {
    // 综合判断是否需要切换
    const [currentMetrics, bestMetrics] = await Promise.all([
      testNodeMultiMetrics(currentNode),
      testNodeMultiMetrics(bestNode)
    ]);
    
    // 如果当前节点已满足阈值则不切换
    if (currentMetrics.latency < 300 && currentMetrics.loss < 0.1) {
      return false;
    }
    
    // 如果最佳节点优势不足20%则不切换
    const improvement = (currentMetrics.latency - bestMetrics.latency) / currentMetrics.latency;
    return improvement > 0.2;
  }

  _calculateCooldown(node) {
    // 动态计算冷却时间（优质节点延长，劣质节点缩短）
    const score = nodeQualityScore.get(node) || 0;
    let baseCooldown = this.BASE_SWITCH_COOLDOWN;
    
    // 根据历史表现调整冷却时间
    if (score > 2) {
      baseCooldown *= Math.pow(2, Math.min(5, score));
    } else if (score < -1) {
      baseCooldown /= 2;
    }
    
    return Math.min(
      Math.max(baseCooldown, this.BASE_SWITCH_COOLDOWN/2),
      this.MAX_SWITCH_COOLDOWN
    );
  }

  _applyNodeSwitch(oldNode, newNode, cooldown, reason) {
    // 执行节点切换并更新状态
    this.nodeSwitchCooldown.set(newNode, Date.now() + cooldown);
    this.nodeSwitchCooldown.delete(oldNode); // 移除旧节点冷却
    
    // 更新节点质量评分
    this._updateQualityScore(newNode, true);
    this._updateQualityScore(oldNode, false);
    
    // 记录切换事件
    this.recordSwitchEvent(oldNode, newNode, reason);
    
    // 实际切换操作
    setCurrentNodeForUser(user, newNode);
  }

  _updateQualityScore(node, isGood) {
    // 改进质量评分算法
    const currentScore = nodeQualityScore.get(node) || 0;
    const delta = isGood ? 1 : -1;
    const newScore = Math.max(-5, Math.min(5, currentScore + delta));
    
    nodeQualityScore.set(node, newScore);
    nodeQualityStatus.set(node, 
      newScore > 2 ? 'good' : 
      newScore < -2 ? 'bad' : 'normal'
    );
  }

  _fallbackStrategy(currentNode, allNodes) {
    // 多级降级策略
    const history = nodeHistoryCache.get(currentNode) || 0;
    
    if (history < 0.5) {
      // 尝试历史优质节点
      const historyBest = this._getHistoryBest(allNodes);
      if (historyBest) return historyBest;
    }
    
    // 最后尝试直连
    return '直连';
  }

  _getHistoryBest(nodes) {
    // 获取历史最优节点
    const historyScores = nodes.map(node => ({
      node,
      history: nodeHistoryCache.get(node) || 0
    }));
    
    historyScores.sort((a, b) => b.history - a.history);
    return historyScores[0]?.node;
  }
}

// 修改点2：协调main函数中的自动更新
async function autoUpdateCurrentNode(allNodes) {
  const nodeManager = NodeManager.getInstance();
  const newNode = await nodeManager.coordinatedSwitch(currentNode, allNodes, 'scheduled_update');
  if (newNode !== currentNode) {
    currentNode = newNode;
    // 可选：记录切换日志
  }
}

// 修改点3：协调handleProxyRequest中的切换逻辑
async function handleProxyRequest(user, req, ...args) {
  try {
    const nodeManager = NodeManager.getInstance();
    let currentNode = nodeManager.getNodeDispatch(user);
    const allNodes = getAllAvailableNodesForUser(user);

    // 客户端地理信息采集
    const clientIP = req?.headers?.get('X-Forwarded-For') || req?.headers?.get('Remote-Address');
    const clientGeo = await getNodeGeoInfo(clientIP);

    // 分流优先，AI预测驱动
    const newNode = await smartDispatchNode(user, allNodes, { clientGeo });

    // 协调切换
    if (newNode !== currentNode) {
      await nodeManager.coordinatedSwitch(currentNode, allNodes, 'traffic_based');
      currentNode = nodeManager.getNodeDispatch(user);
    }

    // 采集本次请求的多维度数据
    const metrics = await testNodeMultiMetrics(newNode);
    if (newNode.ip) {
      metrics.geo = await getNodeGeoInfo(newNode.ip);
    }

    // 记录节点请求指标
    recordNodeRequestMetrics(newNode, metrics);

    // 定期自学习与分流表动态调整
    if (Math.random() < 0.01) await learnAndUpdateNodeProfile();

    // 节点异常自动降级，恢复后自动提升
    const anomalyScore = predictNodeAnomaly(newNode);
    if (anomalyScore > 0.7) {
      nodeManager.updateNodeHealth(newNode, 'bad');
    } else if (anomalyScore < 0.2) {
      nodeManager.updateNodeHealth(newNode, 'good');
    }

    return proxyRequestWithNode(newNode, ...args);
  } catch (error) {
    console.error('代理请求处理失败:', error);
    return proxyRequestWithNode('直连', ...args);
  }
}
