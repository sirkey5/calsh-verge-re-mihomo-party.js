// ========== 重要维护提示 ==========
// 所有后续新增的变量、函数、类、常量等，必须在本文件中显式定义，严禁未定义直接调用，防止ReferenceError: not defined等运行时错误。
// 如有跨文件依赖，需在本文件顶部或相关位置补充声明或导入。
// 本文件采用事件触发驱动机制，禁制使用定时机制和逻辑。
// ===================================

// 全局常量定义 - 集中管理所有常量，提高可维护性
const CONSTANTS = {
  PREHEAT_NODE_COUNT: 10,        // 预热节点数量
  BATCH_SIZE: 5,                 // 批处理大小
  NODE_TEST_TIMEOUT: 5000,       // 节点测试超时时间(ms)
  BASE_SWITCH_COOLDOWN: 30 * 60 * 1000,  // 基础冷却时间30分钟
  MIN_SWITCH_COOLDOWN: 5 * 60 * 1000,   // 最小冷却时间5分钟
  MAX_SWITCH_COOLDOWN: 2 * 60 * 60 * 1000, // 最大冷却时间2小时
  MAX_HISTORY_RECORDS: 100,      // 最大历史记录数
  NODE_EVALUATION_THRESHOLD: 3 * 60 * 60 * 1000, // 节点评估阈值(3小时)
  LRU_CACHE_MAX_SIZE: 1000,      // LRU缓存最大大小
  LRU_CACHE_TTL: 3600000,        // LRU缓存过期时间(ms)
  QUALITY_SCORE_THRESHOLD: 30,   // 节点质量分阈值
  NODE_CLEANUP_THRESHOLD: 20,    // 节点清理阈值
  GEO_INFO_TIMEOUT: 3000,        // 地理信息请求超时(ms)
  FEATURE_WINDOW_SIZE: 10        // 特征提取窗口大小
};


// 事件发射器基类 - 提供事件监听和触发功能
class EventEmitter {
  constructor() {
    this.eventListeners = new Map();
  }

  // 添加事件监听
  on(event, listener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(listener);
  }

  // 移除事件监听
  off(event, listener) {
    if (!this.eventListeners.has(event)) return;
    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
    if (listeners.length === 0) this.eventListeners.delete(event);
  }

  // 触发事件
  emit(event, ...args) {
    if (!this.eventListeners.has(event)) return;
    // 创建监听器副本以防止在触发过程中修改数组
    [...this.eventListeners.get(event)].forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        Logger.error(`事件 ${event} 处理失败:`, error.stack);
      }
    });
  }

  // 移除所有事件监听
  removeAllListeners(event) {
    if (event) {
      this.eventListeners.delete(event);
    } else {
      this.eventListeners.clear();
    }
  }
}

class AppState {
  constructor() {
    this.nodes = new Map();
    this.metrics = new Map();
    this.config = {};
    this.lastUpdated = Date.now();
  }

  updateNodeStatus(nodeId, status) {
    this.nodes.set(nodeId, { ...this.nodes.get(nodeId), ...status });
    this.lastUpdated = Date.now();
  }
}

class RollingStats {
  constructor(windowSize = 100) {
    this.windowSize = windowSize;
    this.data = [];
  }

  add(value) {
    this.data.push(value);
    if (this.data.length > this.windowSize) this.data.shift();
  }

  get average() {
    return this.data.length ? this.data.reduce((a, b) => a + b, 0) / this.data.length : 0;
  }

  reset() { this.data = []; }
}

class SuccessRateTracker {
  constructor() {
    this.successCount = 0;
    this.totalCount = 0;
  }

  record(success) {
    this.totalCount++;
    if (success) this.successCount++;
  }

  get rate() {
    return this.totalCount ? this.successCount / this.totalCount : 0;
  }

  reset() { this.successCount = 0; this.totalCount = 0; }
}

class LRUCache {
  constructor({ maxSize, ttl }) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.head = { key: null, value: null, prev: null, next: null };
    this.tail = { key: null, value: null, prev: this.head, next: null };
    this.head.next = this.tail;
  }

  _moveToFront(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _removeTail() {
    const node = this.tail.prev;
    this.tail.prev = node.prev;
    node.prev.next = this.tail;
    this.cache.delete(node.key);
    return node.key;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry || Date.now() - entry.timestamp > this.ttl) {
      if (entry) {
        entry.prev.next = entry.next;
        entry.next.prev = entry.prev;
        this.cache.delete(key);
      }
      return null;
    }
    this._moveToFront(entry);
    entry.timestamp = Date.now();
    return entry.value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      entry.value = value;
      entry.timestamp = Date.now();
      this._moveToFront(entry);
      return;
    }

    if (this.cache.size >= this.maxSize) {
      this._removeTail();
    }

    const newNode = {
      key,
      value,
      timestamp: Date.now(),
      prev: this.head,
      next: this.head.next
    };
    this.head.next.prev = newNode;
    this.head.next = newNode;
    this.cache.set(key, newNode);
  }
}

class NodeManager extends EventEmitter {
  static getInstance() {
    if (!NodeManager.instance) NodeManager.instance = new NodeManager();
    return NodeManager.instance;
  }

  constructor() {
    super();
    this.currentNode = null;
    this.nodeQuality = new Map();
    this.switchCooldown = new Map();
    this.BASE_SWITCH_COOLDOWN = CONSTANTS.BASE_SWITCH_COOLDOWN; // 基础冷却时间
this.MIN_SWITCH_COOLDOWN = CONSTANTS.MIN_SWITCH_COOLDOWN; // 最小冷却时间
this.MAX_SWITCH_COOLDOWN = CONSTANTS.MAX_SWITCH_COOLDOWN; // 最大冷却时间
this.nodeHistory = new Map(); // 节点历史记录
this.MAX_HISTORY_RECORDS = CONSTANTS.MAX_HISTORY_RECORDS; // 最大历史记录数
  }
  async getBestNode(nodes) {
    // 过滤掉冷却期内的节点
    const availableNodes = nodes.filter(node => !this.isInCooldown(node.id));
    if (availableNodes.length === 0) return nodes[0];

    // 找到质量分最高的节点
    return availableNodes.reduce((best, current) => {
      const bestScore = this.nodeQuality.get(best.id) || 0;
      const currentScore = this.nodeQuality.get(current.id) || 0;
      return currentScore > bestScore ? current : best;
    }, availableNodes[0]);
  }

  updateNodeQuality(nodeId, score) {
    const current = this.nodeQuality.get(nodeId) || 0;
    // 限制分数范围在0-100
    const newScore = Math.max(0, Math.min(100, current + score));
    this.nodeQuality.set(nodeId, newScore);

    // 更新历史记录
    this._updateNodeHistory(nodeId, newScore);
  }

  async switchToBestNode(nodes) {
    if (!nodes || nodes.length === 0) return null;

    const bestNode = await this.getBestNode(nodes);
    if (!bestNode) return null;

    // 记录切换前的节点
    const oldNodeId = this.currentNode;

    // 应用新节点
    this.currentNode = bestNode.id;

    // 设置冷却期
    this.switchCooldown.set(bestNode.id, Date.now() + this._getCooldownTime(bestNode.id));

    // 记录切换事件
    this._recordSwitchEvent(oldNodeId, bestNode.id);

    console.log(`节点已切换: ${oldNodeId || '无'} -> ${bestNode.id} (质量分: ${this.nodeQuality.get(bestNode.id)})`);
    return bestNode;
  }

  isInCooldown(nodeId) {
    const cooldownEnd = this.switchCooldown.get(nodeId);
    return cooldownEnd && Date.now() < cooldownEnd;
  }

  _getCooldownTime(nodeId) {
    // 根据节点质量动态调整冷却时间
    const score = this.nodeQuality.get(nodeId) || 0;
    // 质量越高冷却时间越长，最低5分钟，最高2小时
    return Math.max(5 * 60 * 1000, Math.min(2 * 60 * 60 * 1000, this.BASE_SWITCH_COOLDOWN * (1 + score / 100)));
  }

  _updateNodeHistory(nodeId, score) {
    const history = this.nodeHistory.get(nodeId) || [];
    history.push({ timestamp: Date.now(), score });
    // 保留最近MAX_HISTORY_RECORDS条记录
    if (history.length > this.MAX_HISTORY_RECORDS) history.shift();
    this.nodeHistory.set(nodeId, history);
  }

  _recordSwitchEvent(oldNodeId, newNodeId) {
    // 可以扩展为更详细的日志记录
    const event = {
      timestamp: Date.now(),
      oldNodeId,
      newNodeId,
      reason: oldNodeId ? '质量过低' : '初始选择'
    };
    // 实际应用中可以将切换事件存储到日志系统
  }
}

class CentralManager extends EventEmitter {
  constructor() {
    super();
    this.state = new AppState();
    this.stats = new RollingStats();
    this.successTracker = new SuccessRateTracker();
    this.nodeManager = NodeManager.getInstance();
    this.lruCache = new LRUCache({ maxSize: 1000, ttl: 3600000 });
    // 常量定义
    // 使用全局常量代替类内常量定义
    this.initialize();
  }
  async initialize() {
    await this.loadAIDBFromFile();
    this.setupEventListeners();
    await this.preheatNodes();
    // 事件驱动模式下无需定时任务，通过事件触发节点评估
  }

  /**
   * 从持久化存储加载AI节点数据
   * @returns {Promise<void>} 加载完成Promise
   */
  loadAIDBFromFile() {
    return new Promise((resolve) => {
      try {
        let raw = '';
        // 尝试从不同环境的存储中读取数据
        if (typeof $persistentStore !== 'undefined') {
          raw = $persistentStore.read('ai_node_data') || '';
        } else if (typeof window !== 'undefined' && window.localStorage) {
          raw = window.localStorage.getItem('ai_node_data') || '';
        }

        if (raw) {
          try {
            const data = JSON.parse(raw);
            // 验证数据格式
            if (typeof data === 'object' && data !== null) {
              Object.entries(data).forEach(([id, stats]) => {
                this.state.metrics.set(id, stats);
              });
              Logger.info(`成功加载AI节点数据，共${this.state.metrics.size}条记录`);
            } else {
              Logger.error('AI数据格式无效，预期为对象');
            }
          } catch (parseError) {
            Logger.error('AI数据解析失败:', parseError.stack);
            // 尝试删除损坏的数据
            if (typeof $persistentStore !== 'undefined') {
              $persistentStore.write('', 'ai_node_data');
            } else if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem('ai_node_data');
            }
          }
        }
      } catch (e) {
        Logger.error('AI数据加载失败:', e.stack);
      } finally {
        resolve();
      }
    });
  }

  saveAIDBToFile() {
    try {
      const data = Object.fromEntries(this.state.metrics.entries());
      const raw = JSON.stringify(data, null, 2);
      if (typeof $persistentStore !== 'undefined') {
        $persistentStore.write(raw, 'ai_node_data');
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('ai_node_data', raw);
      }
    } catch (e) {
      Logger.error('AI数据保存失败:', e.stack);
    }
  }
  setupEventListeners() {
    // 监听节点状态变化事件
    this.state.nodes.forEach((value, nodeId) => {
      this.state.nodes.on('update', (id, status) => {
        if (id === nodeId) this.nodeManager.updateNodeQuality(id, status.score || 0);
      });
    });

    // 添加新的事件监听器
    // 配置变更事件
    if (typeof Config !== 'undefined' && Config.on) {
      Config.on('configChanged', async () => {
        console.log('配置变更，触发节点评估...');
        await this.evaluateAllNodes();
      });
    }

    // 网络状态变更事件
    if (typeof window !== 'undefined') {
      window.addEventListener('online', async () => {
        console.log('网络恢复，触发节点评估...');
        await this.evaluateAllNodes();
      });
    }

    // 节点性能阈值突破事件
    this.nodeManager.on('performanceThresholdBreached', async (nodeId) => {
      console.log(`节点 ${nodeId} 性能阈值突破，触发单节点评估...`);
      await this.evaluateNodeQuality(this.state.config.proxies?.find(n => n.id === nodeId));
    });

    // 评估完成事件 - 用于触发数据保存和节点清理
    this.on('evaluationCompleted', () => {
      console.log('节点评估完成，触发数据保存和节点清理...');
      this.saveAIDBToFile();
      this.autoEliminateNodes();
    });
  }

  async preheatNodes() {
    const proxies = this.state.config.proxies || [];
    if (proxies.length === 0) return;

    const testNodes = proxies.slice(0, this.CONSTANTS.PREHEAT_NODE_COUNT);
    const results = [];

    // 分批处理，限制并发数
    for (let i = 0; i < testNodes.length; i += this.BATCH_SIZE) {
      const batch = testNodes.slice(i, i + this.BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(node => this.testNodeMultiMetrics(node))
      );
      results.push(...batchResults);
      // 批处理间隔，避免资源占用过高
      if (i + this.BATCH_SIZE < testNodes.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        Logger.error(`节点预热失败: ${testNodes[index].id}`, result.reason);
        return;
      }
      if (result.status === 'fulfilled') {
        const node = testNodes[index];
        this.state.updateNodeStatus(node.id, {
          initialMetrics: result.value,
          lastTested: Date.now()
        });
        this.nodeManager.updateNodeQuality(node.id, this.calculateInitialQualityScore(result.value));
      }
    });
  }

  calculateInitialQualityScore(metrics) {
    // 基于多维度指标计算初始质量分
    return (100 - metrics.latency / 20) + 
           (1 - metrics.loss) * 50 + 
           (1 - metrics.jitter / 100) * 30;
  }

  // 重命名方法，移除periodic前缀
  async evaluateAllNodes() {
    const proxies = this.state.config.proxies || [];
    if (proxies.length === 0) return;

    // 分批评估节点，避免资源占用过高
    for (let i = 0; i < proxies.length; i += this.CONSTANTS.BATCH_SIZE) {
      const batch = proxies.slice(i, i + this.BATCH_SIZE);
      await Promise.all(batch.map(node => this.evaluateNodeQuality(node)));
      await new Promise(resolve => setTimeout(resolve, 1000)); // 批处理间隔
    }

    // 触发评估完成事件
    this.emit('evaluationCompleted');
  }

  async evaluateNodeQuality(node) {
    const metrics = await this.testNodeMultiMetrics(node);
    const score = this.calculateNodeQualityScore(metrics);

    this.nodeManager.updateNodeQuality(node.id, score);
    this.state.updateNodeStatus(node.id, {
      metrics,
      score,
      lastEvaluated: Date.now()
    });

    // 如果是当前节点且质量过低，触发切换
    if (this.nodeManager.currentNode === node.id && score < 30) {
      await this.nodeManager.switchToBestNode(this.state.config.proxies);
    }
  }

  calculateNodeQualityScore(metrics) {
    // 综合多维度指标计算质量分 (0-100)
    const latencyScore = Math.max(0, Math.min(40, 40 - metrics.latency / 25));
    const jitterScore = Math.max(0, Math.min(30, 30 - metrics.jitter));
    const lossScore = Math.max(0, Math.min(30, 30 * (1 - metrics.loss)));
    return Math.round(latencyScore + jitterScore + lossScore);
  }

  autoEliminateNodes() {
    const proxies = this.state.config.proxies || [];
    const thresholdTime = Date.now() - this.CONSTANTS.NODE_EVALUATION_THRESHOLD; // 3小时未评估

    proxies.forEach(node => {
      const status = this.state.nodes.get(node.id);
      if (!status || status.lastEvaluated < thresholdTime || status.score < 20) {
        this.state.nodes.delete(node.id);
        this.state.metrics.delete(node.id);
        this.nodeManager.nodeQuality.delete(node.id);
        console.log(`已清理异常节点: ${node.id}`);
      }
    });
  }

  async handleProxyRequest(req, ...args) {
    try {
      // 获取当前用户和可用节点
      const user = req.user || 'default';
      const allNodes = this.state.config.proxies || [];
      if (allNodes.length === 0) {
        console.warn('没有可用代理节点，将使用直连模式');
        return this.proxyToDirect(...args);
      }

      // 确保有活跃节点
      let currentNode = this.nodeManager.currentNode ? 
        allNodes.find(n => n.id === this.nodeManager.currentNode) : null;

      // 如果没有当前节点或当前节点不可用，选择最佳节点
      if (!currentNode || !this.state.nodes.has(currentNode.id)) {
        currentNode = await this.nodeManager.switchToBestNode(allNodes);
      }

      // 采集客户端地理信息
      const clientIP = req.headers['X-Forwarded-For'] || req.headers['Remote-Address'];
      const clientGeo = await this.getGeoInfo(clientIP);

      // 智能分流决策
      const targetNode = await this.smartDispatchNode(user, allNodes, { clientGeo, req });

      // 如果需要切换节点
      if (targetNode && targetNode.id !== currentNode.id) {
        currentNode = await this.nodeManager.switchToBestNode(allNodes);
      }

      // 执行代理请求并记录指标
      const result = await this.proxyRequestWithNode(currentNode, ...args);
      this.recordRequestMetrics(currentNode, result, req);

      return result;
    } catch (error) {
      console.error('代理请求处理失败:', error);
      return this.proxyToDirect(...args);
    }
  }

  async smartDispatchNode(user, nodes, context) {
    // 基于用户、地理信息和请求特征智能选择节点
    const cacheKey = `${user}:${context.clientGeo?.country || 'unknown'}:${context.req?.url?.hostname || 'unknown'}`;
    const cachedNode = this.lruCache.get(cacheKey);

    if (cachedNode) {
      const node = nodes.find(n => n.id === cachedNode);
      if (node) return node;
      // 缓存节点不存在时清除无效缓存
      this.lruCache.set(cacheKey, null);
    }

    // 基于内容类型的分流策略
    const contentType = context.req?.headers['Content-Type'] || '';
    const url = context.req?.url || '';

    // 视频流优先选择低延迟节点
    if (contentType.includes('video') || url.match(/youtube|netflix|stream/i)) {
      const candidates = nodes.filter(n => this.state.nodes.get(n.id)?.score > CONSTANTS.QUALITY_SCORE_THRESHOLD);
      if (candidates.length > 0) {
        const best = await this.nodeManager.getBestNode(candidates);
        this.lruCache.set(cacheKey, best.id);
        return best;
      }
    }

    // 默认返回最佳节点
    const bestNode = await this.nodeManager.getBestNode(nodes);
    this.lruCache.set(cacheKey, bestNode.id);
    return bestNode;
  }

  async getGeoInfo(ip) {
    if (!ip) {
      Logger.warn('获取地理信息失败: IP地址为空');
      return { country: 'Unknown', region: 'Unknown' };
    }
    // 模拟获取IP地理信息
    if (!ip || ip === '127.0.0.1') {
      return { country: 'Local', region: 'Local' };
    }

    try {
      // 使用真实IP地理信息API获取数据
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.GEO_INFO_TIMEOUT);
      const response = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP错误: ${response.status}`);
      return await response.json();
    } catch (error) {
      Logger.error(`获取地理信息失败: ${error.message}`);
      // 返回随机模拟数据作为降级方案
      const countries = ['China', 'US', 'JP', 'HK', 'SG'];
      return { 
        country: countries[Math.floor(Math.random() * countries.length)],
        region: 'Unknown'
      };
    }
    const countries = ['China', 'US', 'JP', 'HK', 'SG'];
    return { 
      country: countries[Math.floor(Math.random() * countries.length)],
      region: 'Unknown'
    };
  }

  async proxyRequestWithNode(node, ...args) {
    if (!node) {
      throw new Error('代理请求失败: 节点信息不存在');
    }
    try {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.NODE_TEST_TIMEOUT);
      // 实际代理请求实现
      const response = await fetch(node.proxyUrl, { 
        ...args,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const result = { 
        success: true,
        latency: Date.now() - startTime,
        bytes: parseInt(response.headers.get('Content-Length') || '0')
      };
      return result;
    } catch (error) {
      Logger.error(`代理请求失败 [${node.id}]: ${error.message}`);
      return { 
        success: false,
        error: error.message,
        latency: CONSTANTS.NODE_TEST_TIMEOUT
      };
    }
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: true,
          latency: Math.random() * 100 + 50,
          bytes: Math.random() * 1024 * 1024
        });
      }, Math.random() * 100);
    });
  }

  proxyToDirect(...args) {
    // 直连处理
    return { success: true, direct: true };
  }

  recordRequestMetrics(node, result, req) {
    if (!node || !result) return;

    // 记录请求指标用于后续分析
    const metrics = {
      timestamp: Date.now(),
      nodeId: node.id,
      success: result.success,
      latency: result.latency,
      url: req?.url || '',
      method: req?.method || '',
      bytes: result.bytes || 0
    };

    // 简单的成功/失败记录
    this.successTracker.record(result.success);
    if (result.latency) this.stats.add(result.latency);

    // AI节点评分
    const aiScore = this.aiScoreNode(node, metrics);
    this.nodeManager.updateNodeQuality(node.id, aiScore);
  }

  /**
   * AI节点评分模型 - 基于多维度指标预测节点未来表现
   * @param {Object} node - 节点对象
   * @param {Object} metrics - 当前请求指标
   * @returns {number} 评分调整值 (-10 到 +10)
   * 
   * 评分逻辑:
   * 1. 提取节点特征(当前指标、统计特征、趋势特征、历史质量分特征)
   * 2. 预测节点未来表现(风险评估、预期延迟、稳定性)
   * 3. 计算评分调整值，引导节点选择策略
   */
  aiScoreNode(node, metrics) {
    // 基于多维度指标的AI评分模型
    const nodeHistory = this.nodeManager.nodeHistory.get(node.id) || [];
    const recentMetrics = this.state.metrics.get(node.id) || [];

    // 特征提取 - 从历史数据中提取关键性能指标
    const features = this.extractNodeFeatures(node, metrics, recentMetrics, nodeHistory);

    // 预测未来表现 - 使用特征数据预测节点稳定性和延迟
    const prediction = this.predictNodeFuturePerformance(features);

    // 计算评分调整值 (-10 到 +10)
    return this.calculateScoreAdjustment(prediction, metrics.success);
  }

  extractNodeFeatures(node, currentMetrics, recentMetrics, history) {
    // 提取节点特征用于AI评分
    const featureWindow = recentMetrics.slice(-CONSTANTS.FEATURE_WINDOW_SIZE); // 最近N次指标
    if (featureWindow.length < 5) return this.getDefaultFeatures(currentMetrics);

    // 计算统计特征
    const latencies = featureWindow.map(m => m.latency);
    const losses = featureWindow.map(m => m.loss);
    const jitters = featureWindow.map(m => m.jitter);

    return {
      // 当前指标
      currentLatency: currentMetrics.latency,
      currentLoss: currentMetrics.loss,
      currentJitter: currentMetrics.jitter,
      success: currentMetrics.success ? 1 : 0,

      // 统计特征
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      latencyStd: this.calculateStdDev(latencies),
      avgLoss: losses.reduce((a, b) => a + b, 0) / losses.length,
      avgJitter: jitters.reduce((a, b) => a + b, 0) / jitters.length,

      // 趋势特征
      latencyTrend: this.calculateTrend(latencies),
      lossTrend: this.calculateTrend(losses),

      // 历史质量分特征
      qualityTrend: history.length >= 2 ? history[history.length - 1].score - history[history.length - 2].score : 0,
      recentQuality: history.length ? history[history.length - 1].score : 50
    };
  }

  getDefaultFeatures(currentMetrics) {
    // 当数据不足时使用默认特征
    return {
      currentLatency: currentMetrics.latency,
      currentLoss: currentMetrics.loss,
      currentJitter: currentMetrics.jitter,
      success: currentMetrics.success ? 1 : 0,
      avgLatency: currentMetrics.latency,
      latencyStd: 0,
      avgLoss: currentMetrics.loss,
      avgJitter: currentMetrics.jitter,
      latencyTrend: 0,
      lossTrend: 0,
      qualityTrend: 0,
      recentQuality: 50
    };
  }

  calculateStdDev(values) {
    // 计算标准差
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length);
  }

  calculateTrend(values) {
    // 计算趋势（简单线性回归斜率）
    const n = values.length;
    const sumX = n * (n - 1) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((acc, val, idx) => acc + idx * val, 0);
    const sumX2 = n * (n - 1) * (2 * n - 1) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope || 0;
  }

  predictNodeFuturePerformance(features) {
    // 预测节点未来表现
    // 基于特征计算风险分数 (0-1)
    let risk = 0;

    // 高延迟增加风险
    risk += Math.min(features.currentLatency / 1000, 1) * 0.3;

    // 高丢包增加风险
    risk += features.currentLoss * 0.3;

    // 延迟标准差高增加风险（不稳定）
    risk += Math.min(features.latencyStd / 100, 1) * 0.2;

    // 负面趋势增加风险
    if (features.latencyTrend > 5) risk += 0.1;
    if (features.lossTrend > 0.1) risk += 0.1;

    // 低质量分增加风险
    risk += Math.max(0, (50 - features.recentQuality) / 50) * 0.2;

    // 成功状态降低风险
    risk *= (1 - features.success * 0.3);

    // 确保风险在0-1之间
    risk = Math.max(0, Math.min(1, risk));

    return {
      risk,
      expectedLatency: features.avgLatency + features.latencyTrend * 5,
      expectedStability: 1 - risk
    };
  }

  calculateScoreAdjustment(prediction, success) {
    // 基于预测结果计算评分调整值
    if (!success) return -10; // 失败大幅扣分

    // 根据风险预测调整分数
    if (prediction.risk < 0.3) return 5;  // 低风险加分
    if (prediction.risk < 0.5) return 2;  // 中低风险小幅加分
    if (prediction.risk > 0.7) return -3; // 高风险扣分
    return 0; // 中等风险不调整
  }
}

const centralManager = new CentralManager();

const Config = {
  // 总开关
  enable: true,

  // 分流规则配置
  ruleOptions: {
    apple: true,       // 苹果服务
    microsoft: true,  // 微软服务
    github: true,     // Github服务
    google: true,     // Google服务
    openai: true,     // 国外AI和GPT
    spotify: true,    // Spotify
    youtube: true,    // YouTube
    bahamut: true,    // 巴哈姆特/动画疯
    netflix: true,    // Netflix网飞
    tiktok: true,     // 国际版抖音
    disney: true,     // 迪士尼
    pixiv: true,      // Pixiv
    hbo: true,        // HBO
    biliintl: true,   // 哔哩哔哩东南亚
    tvb: true,        // TVB
    hulu: true,       // Hulu
    primevideo: true, // 亚马逊prime video
    telegram: true,   // Telegram通讯软件
    line: true,       // Line通讯软件
    whatsapp: true,   // Whatsapp
    games: true,      // 游戏策略组
    japan: true,      // 日本网站策略组
    tracker: true,    // 网络分析和跟踪服务
    ads: true         // 常见的网络广告
  },

  // 前置规则
  preRules: [
    'RULE-SET,applications,下载软件',
    'PROCESS-NAME,SunloginClient,DIRECT',
    'PROCESS-NAME,SunloginClient.exe,DIRECT',
    'PROCESS-NAME,AnyDesk,DIRECT',
    'PROCESS-NAME,AnyDesk.exe,DIRECT'
  ],

  // 地区配置
  regionOptions: {
    excludeHighPercentage: true,
    ratioLimit: 2, // 统一倍率限制
    regions: [
      { name: 'HK香港', regex: /港|🇭🇰|hk|hongkong|hong kong/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png' },
      { name: 'US美国', regex: /美|🇺🇸|us|united state|america/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png' },
      { name: 'JP日本', regex: /日本|🇯🇵|jp|japan/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png' },
      { name: 'KR韩国', regex: /韩|🇰🇷|kr|korea/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Korea.png' },
      { name: 'SG新加坡', regex: /新加坡|🇸🇬|sg|singapore/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Singapore.png' },
      { name: 'CN中国大陆', regex: /中国|🇨🇳|cn|china/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/China_Map.png' },
      { name: 'TW台湾省', regex: /台湾|🇹🇼|tw|taiwan|tai wan/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/China.png' },
      { name: 'GB英国', regex: /英|🇬🇧|uk|united kingdom|great britain/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_Kingdom.png' },
      { name: 'DE德国', regex: /德国|🇩🇪|de|germany/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Germany.png' },
      { name: 'MY马来西亚', regex: /马来|my|malaysia/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Malaysia.png' }, // 修复国旗表情错误
      { name: 'TK土耳其', regex: /土耳其|🇹🇷|tk|turkey/i, icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Turkey.png' }
    ]
  },

  // DNS配置
  dns: {
    enable: true,
    listen: ':1053',
    ipv6: true,
    'prefer-h3': true,
    'use-hosts': true,
    'use-system-hosts': true,
    'respect-rules': true,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter': ['*', '+.lan', '+.local', '+.market.xiaomi.com'],
    nameserver: ['https://120.53.53.53/dns-query', 'https://223.5.5.5/dns-query'],
    'proxy-server-nameserver': ['https://120.53.53.53/dns-query', 'https://223.5.5.5/dns-query'],
    'nameserver-policy': {
      'geosite:private': 'system',
      'geosite:cn,steam@cn,category-games@cn,microsoft@cn,apple@cn': ['119.29.29.29', '223.5.5.5']
    }
  },

  // 服务配置 - 数据驱动定义所有服务
  services: [
    { id: 'openai', rule: ['DOMAIN-SUFFIX,grazie.ai,国外AI', 'DOMAIN-SUFFIX,grazie.aws.intellij.net,国外AI', 'RULE-SET,ai,国外AI'], name: '国外AI', url: 'https://chat.openai.com/cdn-cgi/trace', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/ChatGPT.png', ruleProvider: {name: 'ai', url: 'https://github.com/dahaha-365/YaNet/raw/refs/heads/dist/rulesets/mihomo/ai.list'} },
    { id: 'youtube', rule: ['GEOSITE,youtube,YouTube'], name: 'YouTube', url: 'https://www.youtube.com/s/desktop/494dd881/img/favicon.ico', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/YouTube.png' },
    { id: 'biliintl', rule: ['GEOSITE,biliintl,哔哩哔哩东南亚'], name: '哔哩哔哩东南亚', url: 'https://www.bilibili.tv/', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/bilibili_3.png', proxiesOrder: ['默认节点', '直连'] },
    { id: 'bahamut', rule: ['GEOSITE,bahamut,巴哈姆特'], name: '巴哈姆特', url: 'https://ani.gamer.com.tw/ajax/getdeviceid.php', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Bahamut.png', proxiesOrder: ['默认节点', '直连'] },
    { id: 'disney', rule: ['GEOSITE,disney,Disney+'], name: 'Disney+', url: 'https://disney.api.edge.bamgrid.com/devices', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Disney+.png' },
    { id: 'netflix', rule: ['GEOSITE,netflix,NETFLIX'], name: 'NETFLIX', url: 'https://api.fast.com/netflix/speedtest/v2?https=true', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Netflix.png' },
    { id: 'tiktok', rule: ['GEOSITE,tiktok,Tiktok'], name: 'Tiktok', url: 'https://www.tiktok.com/', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/TikTok.png' },
    { id: 'spotify', rule: ['GEOSITE,spotify,Spotify'], name: 'Spotify', url: 'http://spclient.wg.spotify.com/signup/public/v1/account', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Spotify.png' },
    { id: 'pixiv', rule: ['GEOSITE,pixiv,Pixiv'], name: 'Pixiv', url: 'https://www.pixiv.net/favicon.ico', icon: 'https://play-lh.googleusercontent.com/8pFuLOHF62ADcN0ISUAyEueA5G8IF49mX_6Az6pQNtokNVHxIVbS1L2NM62H-k02rLM=w240-h480-rw' }, // 修复错误的URL
    { id: 'hbo', rule: ['GEOSITE,hbo,HBO'], name: 'HBO', url: 'https://www.hbo.com/favicon.ico', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/HBO.png' },
    { id: 'tvb', rule: ['GEOSITE,tvb,TVB'], name: 'TVB', url: 'https://www.tvb.com/logo_b.svg', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/TVB.png' },
    { id: 'primevideo', rule: ['GEOSITE,primevideo,Prime Video'], name: 'Prime Video', url: 'https://m.media-amazon.com/images/G/01/digital/video/web/logo-min-remaster.png', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Prime_Video.png' },
    { id: 'hulu', rule: ['GEOSITE,hulu,Hulu'], name: 'Hulu', url: 'https://auth.hulu.com/v4/web/password/authenticate', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hulu.png' },
    { id: 'telegram', rule: ['GEOIP,telegram,Telegram'], name: 'Telegram', url: 'http://www.telegram.org/img/website_icon.svg', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png' },
    { id: 'whatsapp', rule: ['GEOSITE,whatsapp,WhatsApp'], name: 'WhatsApp', url: 'https://web.whatsapp.com/data/manifest.json', icon: 'https://static.whatsapp.net/rsrc.php/v3/yP/r/rYZqPCBaG70.png' },
    { id: 'line', rule: ['GEOSITE,line,Line'], name: 'Line', url: 'https://line.me/page-data/app-data.json', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Line.png' },
    { id: 'games', rule: ['GEOSITE,category-games@cn,国内网站', 'GEOSITE,category-games,游戏专用'], name: '游戏专用', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Game.png' },
    { id: 'tracker', rule: ['GEOSITE,tracker,跟踪分析'], name: '跟踪分析', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Reject.png', proxies: ['REJECT', '直连', '默认节点'] },
    { id: 'ads', rule: ['GEOSITE,category-ads-all,广告过滤', 'RULE-SET,adblockmihomo,广告过滤'], name: '广告过滤', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Advertising.png', proxies: ['REJECT', '直连', '默认节点'], ruleProvider: {name: 'adblockmihomo', url: 'https://github.com/217heidai/adblockfilters/raw/refs/heads/main/rules/adblockmihomo.mrs', format: 'mrs', behavior: 'domain'} },
    { id: 'apple', rule: ['GEOSITE,apple-cn,苹果服务'], name: '苹果服务', url: 'http://www.apple.com/library/test/success.html', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Apple_2.png' },
    { id: 'google', rule: ['GEOSITE,google,谷歌服务'], name: '谷歌服务', url: 'http://www.google.com/generate_204', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Google_Search.png' },
    { id: 'microsoft', rule: ['GEOSITE,microsoft@cn,国内网站', 'GEOSITE,microsoft,微软服务'], name: '微软服务', url: 'http://www.msftconnecttest.com/connecttest.txt', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Microsoft.png' },
    { id: 'github', rule: ['GEOSITE,github,Github'], name: 'Github', url: 'https://github.com/robots.txt', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/GitHub.png' },
    { id: 'japan', rule: ['RULE-SET,category-bank-jp,日本网站', 'GEOIP,jp,日本网站,no-resolve'], name: '日本网站', url: 'https://r.r10s.jp/com/img/home/logo/touch.png', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/JP.png', ruleProvider: {name: 'category-bank-jp', url: 'https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-bank-jp.mrs', format: 'mrs', behavior: 'domain'} }
  ],

  // 系统配置
  system: {
    'allow-lan': true,
    'bind-address': '*',
    mode: 'rule',
    profile: { 'store-selected': true, 'store-fake-ip': true },
    'unified-delay': true,
    'tcp-concurrent': true,
    'keep-alive-interval': 1800,
    'find-process-mode': 'strict',
    'geodata-mode': true,
    'geodata-loader': 'memconservative',
    'geo-auto-update': true,
    'geo-update-interval': 24,
    sniffer: {
      enable: true,
      'force-dns-mapping': true,
      'parse-pure-ip': false,
      'override-destination': true,
      sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: [80, '8080-8880'] }, QUIC: { ports: [443, 8443] } },
      'skip-src-address': ['127.0.0.0/8', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
      'force-domain': ['+.google.com', '+.googleapis.com', '+.googleusercontent.com', '+.youtube.com', '+.facebook.com', '+.messenger.com', '+.fbcdn.net', 'fbcdn-a.akamaihd.net'],
      'skip-domain': ['Mijia Cloud', '+.oray.com']
    },
    ntp: { enable: true, 'write-to-system': false, server: 'cn.ntp.org.cn' },
    'geox-url': {
      geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat',
      geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
      mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb',
      asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb'
    }
  },

  // 通用配置
  common: {
    ruleProvider: { type: 'http', format: 'yaml', interval: 86400 },
    proxyGroup: { interval: 300, timeout: 3000, url: 'http://cp.cloudflare.com/generate_204', lazy: true, 'max-failed-times': 3, hidden: false },
    defaultProxyGroups: [
      { name: '下载软件', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Download.png', proxies: ['直连', 'REJECT', '默认节点', '国内网站'] },
      { name: '其他外网', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Streaming!CN.png', proxies: ['默认节点', '国内网站'] },
      { name: '国内网站', url: 'http://wifi.vivo.com.cn/generate_204', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/StreamingCN.png', proxies: ['直连', '默认节点'] }
    ],
    postRules: ['GEOSITE,private,DIRECT', 'GEOIP,private,DIRECT,no-resolve', 'GEOSITE,cn,国内网站', 'GEOIP,cn,国内网站,no-resolve', 'MATCH,其他外网']
  }
};

/**
 * 工具函数模块 - 提供通用功能
 */
const Utils = {
  /**
   * 提取符合条件的代理节点
   * @param {Array} proxies - 代理节点列表
   * @param {Object} region - 地区配置
   * @returns {Array} 符合条件的代理节点名称列表
   */
  filterProxiesByRegion(proxies, region) {
    return proxies
      .filter(proxy => {
        // 提取倍率值，增强正则表达式健壮性
        const multiplierMatch = proxy.name.match(/(?:[xX✕✖⨉]|倍率)(\d+\.?\d*)/i);
        const multiplier = multiplierMatch ? parseFloat(multiplierMatch[1]) : 0;
        return proxy.name.match(region.regex) && multiplier <= Config.regionOptions.ratioLimit;
      })
      .map(proxy => proxy.name);
  },

  /**
   * 创建服务代理组和规则
   * @param {Object} config - 配置对象
   * @param {Array} regionGroupNames - 地区代理组名称列表
   * @param {Map} ruleProviders - 规则提供者Map
   * @param {Array} rules - 规则列表
   */
  createServiceGroups(config, regionGroupNames, ruleProviders, rules) {
    Config.services.forEach(service => {
      if (!Config.ruleOptions[service.id]) return;

      // 添加规则
      if (Array.isArray(service.rule)) {
        rules.push(...service.rule);
      }

      // 添加规则提供者
      if (service.ruleProvider) {
        ruleProviders.set(service.ruleProvider.name, {
          ...Config.common.ruleProvider,
          behavior: service.ruleProvider.behavior || 'classical',
          format: service.ruleProvider.format || 'text',
          url: service.ruleProvider.url,
          path: `./ruleset/${service.ruleProvider.name.split('-')[0]}/${service.ruleProvider.name}.${service.ruleProvider.format || 'list'}`
        });
      }

      // 创建代理组
      const proxies = service.proxies || [
        '默认节点',
        ...(service.proxiesOrder || []),
        ...regionGroupNames,
        '直连'
      ];

      config['proxy-groups'].push({
        ...Config.common.proxyGroup,
        name: service.name,
        type: 'select',
        proxies: proxies,
        url: service.url || Config.common.proxyGroup.url,
        icon: service.icon
      });
    });
  }
};

/**
 * 主控制器 - 统筹所有模块
 * @param {Object} config - 原始配置对象
 * @returns {Object} 处理后的配置对象
 */
function main(config) {
  // 使用中心管理器统筹所有操作
    centralManager.stats.reset();
    centralManager.successTracker.reset();

  // 验证代理配置
  const proxyCount = config?.proxies?.length ?? 0;
  const proxyProviderCount = typeof config?.['proxy-providers'] === 'object' ? Object.keys(config['proxy-providers']).length : 0;
  if (proxyCount === 0 && proxyProviderCount === 0) {
    throw new Error('配置文件中未找到任何代理');
  }

  // 应用系统配置
  Object.assign(config, Config.system);
  config.dns = Config.dns;

  // 如果总开关关闭，直接返回配置
  if (!Config.enable) return config;

  // 处理地区代理组
  const regionProxyGroups = [];
  let otherProxyGroups = config.proxies.map(proxy => proxy.name);

  Config.regionOptions.regions.forEach(region => {
    const proxies = Utils.filterProxiesByRegion(config.proxies, region);
    if (proxies.length > 0) {
      regionProxyGroups.push({
        ...Config.common.proxyGroup,
        name: region.name,
        type: 'url-test',
        tolerance: 50,
        icon: region.icon,
        proxies: proxies
      });
      // 从其他节点中移除已分类的代理
      otherProxyGroups = otherProxyGroups.filter(name => !proxies.includes(name));
    }
  });

  const regionGroupNames = regionProxyGroups.map(group => group.name);
  if (otherProxyGroups.length > 0) {
    regionGroupNames.push('其他节点');
  }

  // 初始化代理组
  config['proxy-groups'] = [{
    ...Config.common.proxyGroup,
    name: '默认节点',
    type: 'select',
    proxies: [...regionGroupNames, '直连'],
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Proxy.png'
  }];

  // 添加直连代理
  config.proxies = config?.proxies || [];
  if (!config.proxies.some(p => p.name === '直连')) {
    config.proxies.push({ name: '直连', type: 'direct', udp: true });
  }

  // 处理服务规则和代理组
  const ruleProviders = new Map();
  ruleProviders.set('applications', {
    ...Config.common.ruleProvider,
    behavior: 'classical',
    format: 'text',
    url: 'https://fastly.jsdelivr.net/gh/DustinWin/ruleset_geodata@clash-ruleset/applications.list',
    path: './ruleset/DustinWin/applications.list'
  });

  const rules = [...Config.preRules];
  Utils.createServiceGroups(config, regionGroupNames, ruleProviders, rules);

  // 添加默认代理组
  Config.common.defaultProxyGroups.forEach(group => {
    config['proxy-groups'].push({
      ...Config.common.proxyGroup,
      name: group.name,
      type: 'select',
      proxies: [...group.proxies, ...regionGroupNames],
      url: group.url || Config.common.proxyGroup.url,
      icon: group.icon
    });
  });

  // 添加地区代理组
  config['proxy-groups'] = config['proxy-groups'].concat(regionProxyGroups);

  // 添加其他节点代理组
  if (otherProxyGroups.length > 0) {
    config['proxy-groups'].push({
      ...Config.common.proxyGroup,
      name: '其他节点',
      type: 'select',
      proxies: otherProxyGroups,
      icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/World_Map.png'
    });
  }

  // 添加后置规则
  rules.push(...Config.common.postRules);

  // 应用最终规则和规则提供者
  config.rules = rules;
  config['rule-providers'] = Object.fromEntries(ruleProviders);

  return config;
}

// Define the onGenerate function for singbox configuration mixing
const onGenerate = async (config) => {
console.log('[onGenerate] Script started.');

// Find the best node using CentralManager
const centralManager = new CentralManager();
await centralManager.initialize();
const bestNode = await centralManager.nodeManager.getBestNode(config.outbounds || []);

if (bestNode && bestNode.proxyUrl) {
  // Update the proxy outbound with the best node's URL
  const proxyOutbound = config.outbounds.find(outbound => outbound.tag === 'proxy');
  if (proxyOutbound) {
    proxyOutbound.server = bestNode.proxyUrl;
    console.log(`[onGenerate] Updated outbound 'proxy' address to: ${bestNode.proxyUrl}`);
  } else {
    console.warn('[onGenerate] Could not find an outbound with tag "proxy" to update.');
  }
} else if (!config.outbounds || config.outbounds.length === 0) {
  console.warn('[onGenerate] Singbox config does not have outbounds or outbounds array is empty.');
}

console.log('[onGenerate] Script finished.');
return config;
}
