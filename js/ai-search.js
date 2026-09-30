/**
 * AI 智能搜索引擎（RAG 架构）
 * 
 * 两层管道：
 *  Layer 1 - 本地粗筛：字符 n-gram + TF-IDF + 余弦相似度（毫秒级，免费）
 *  Layer 2 - LLM 精排：OpenRouter LLM 从候选里挑最优 + 给推荐理由（可选，需 API Key）
 * 
 * 用户体验：
 *  - 配了 OpenRouter API Key → LLM 推荐 + 理由
 *  - 没配 Key → 自动降级到本地搜索
 */

// =====================================================
//  Layer 1：纯本地语义搜索（快速粗筛）
// =====================================================
const LocalSearch = (() => {
    let sites = [];
    let siteVectors = [];
    let idf = {};
    let vocabSize = 0;

    function tokenize(text) {
        if (!text) return [];
        const clean = text.toLowerCase().replace(/\s+/g, '');
        const tokens = [];
        for (let i = 0; i < clean.length - 1; i++) tokens.push(clean.slice(i, i + 2));
        for (let i = 0; i < clean.length - 2; i++) tokens.push(clean.slice(i, i + 3));
        return tokens;
    }

    function buildTF(site) {
        const tf = {};
        const fields = [
            { text: site.name || '', weight: 3 },
            { text: site.description || '', weight: 1 },
            { text: site.category || '', weight: 2 },
            { text: site.source || '', weight: 1 },
        ];
        for (const { text, weight } of fields) {
            for (const t of tokenize(text)) {
                tf[t] = (tf[t] || 0) + weight;
            }
        }
        return tf;
    }

    function normalizeTF(tf) {
        const avgLen = Object.values(tf).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(tf).length);
        const result = {};
        for (const [term, freq] of Object.entries(tf)) {
            result[term] = freq / (freq + 1.5 * (1 + avgLen));
        }
        return result;
    }

    function cosineSim(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (const [term, val] of Object.entries(a)) {
            normA += val * val;
            if (b[term]) dot += val * b[term];
        }
        for (const val of Object.values(b)) normB += val * val;
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    const SYNONYMS = {
        '声音': ['音频', 'sound', 'voice', 'audio', '噪音', '分离', '提取', '去除'],
        '音频': ['声音', 'sound', 'voice', 'audio', '背景音乐', 'bgm'],
        '配音': ['语音', 'tts', 'text to speech', '朗读', '语音合成'],
        '说话': ['语音', '声音', 'tts'],
        '音乐': ['bgm', 'song', '歌', 'audio'],
        '歌': ['音乐', 'song'],
        '视频': ['video', '电影', '短片', '剪辑'],
        '剪辑': ['视频', 'edit', '裁剪', '拼接'],
        '去掉': ['去除', '移除', '删除', '分离', '消掉', '擦除'],
        '去除': ['去掉', '移除', '删除', '分离', '消掉'],
        '删除': ['去掉', '去除', '移除', '清理'],
        '转换': ['格式', '转成', 'format', 'convert', '变'],
        '转成': ['转换', '格式', 'convert'],
        '图片': ['图像', 'image', 'picture', '照片'],
        '图像': ['图片', 'image', 'photo'],
        '去背': ['抠图', 'remove background', '背景去除', '透明背景'],
        '抠图': ['去背', 'remove background', '背景'],
        '放大': ['超分', 'upscale', 'enhance', '高清化'],
        '清晰': ['高清', 'hd', 'enhance', '锐化', '修复'],
        '聊天': ['chat', '对话', 'assistant', 'bot', 'gpt'],
        '对话': ['聊天', 'chat', 'conversation'],
        '生成': ['create', 'generate', '制作', '创作'],
        '写作': ['write', '写作', '文案', '文章', '写作助手'],
        '文案': ['写作', 'write', '文章'],
        '检测': ['detect', '识别', '判断', 'verify'],
        '识别': ['detect', '检测', 'recognize'],
        '免费': ['free', '无料', '不要钱', 'open source', '开源'],
        '在线': ['online', '网页', 'web', '无需下载'],
        '下载': ['download', '保存', 'dl'],
        '压缩': ['compress', 'zip', '减小', 'reduce'],
        '解压': ['extract', 'unzip', 'decompress'],
        '翻译': ['translate', 'translation', 'lang'],
        'pdf': ['pdf', '文档', 'document'],
        '文档': ['pdf', 'word', 'docx', 'document'],
        '代码': ['code', '编程', 'programming', '开发者'],
        '游戏': ['game', 'mc', 'minecraft', '我的世界', '玩'],
        'minecraft': ['mc', '我的世界', '游戏'],
    };

    function expandQuery(query) {
        const lower = query.toLowerCase();
        const extra = new Set();
        for (const [key, syns] of Object.entries(SYNONYMS)) {
            if (lower.includes(key.toLowerCase())) {
                for (const s of syns) extra.add(s);
            }
        }
        return extra;
    }

    return {
        build(allSites) {
            sites = allSites;
            const rawVectors = sites.map(site => ({ site, tf: buildTF(site) }));

            const docCount = rawVectors.length;
            const df = {};
            for (const { tf } of rawVectors) {
                for (const term of Object.keys(tf)) {
                    df[term] = (df[term] || 0) + 1;
                }
            }
            vocabSize = Object.keys(df).length;
            for (const [term, count] of Object.entries(df)) {
                idf[term] = Math.log((docCount + 1) / (count + 1)) + 1;
            }

            siteVectors = rawVectors.map(({ tf }) => {
                const normalized = normalizeTF(tf);
                const vec = {};
                for (const [term, tfVal] of Object.entries(normalized)) {
                    if (idf[term] !== undefined) {
                        vec[term] = tfVal * idf[term];
                    }
                }
                let norm = 0;
                for (const v of Object.values(vec)) norm += v * v;
                norm = Math.sqrt(norm);
                return { vec, norm };
            });

            console.log(`[LocalSearch] 索引构建完成：${sites.length} 个网站，${vocabSize} 维度`);
        },

        /**
         * 快速粗筛，返回 Top K 候选
         */
        search(query, topK = 15, minScore = 0.03) {
            if (!query || !query.trim()) return [];

            let queryTF = {};
            for (const t of tokenize(query)) queryTF[t] = (queryTF[t] || 0) + 1;
            for (const kw of expandQuery(query)) {
                for (const t of tokenize(kw)) {
                    queryTF[t] = (queryTF[t] || 0) + 0.5;
                }
            }

            const normQueryTF = normalizeTF(queryTF);
            let queryVec = {};
            for (const [term, tfVal] of Object.entries(normQueryTF)) {
                queryVec[term] = (idf[term] !== undefined ? idf[term] : 0.5) * tfVal;
            }
            let qNorm = 0;
            for (const v of Object.values(queryVec)) qNorm += v * v;
            qNorm = Math.sqrt(qNorm);
            if (qNorm === 0) return [];
            for (const k of Object.keys(queryVec)) queryVec[k] /= qNorm;

            const results = [];
            for (let i = 0; i < siteVectors.length; i++) {
                const score = cosineSim(queryVec, siteVectors[i].vec);
                if (score >= minScore) {
                    results.push({ site: sites[i], localScore: score });
                }
            }
            results.sort((a, b) => b.localScore - a.localScore);
            return results.slice(0, topK);
        },

        stats() {
            return { siteCount: sites.length, vocabSize };
        },
    };
})();

// =====================================================
//  Layer 2：LLM 精排（Provider 可切换）
// =====================================================

/**
 * Provider 注册表 —— 每个 Provider 定义自己的 API endpoint、认证方式、默认模型
 * 要加新 Provider 只需在这里加一条
 */
const PROVIDERS = {
    deepseek: {
        name: 'DeepSeek（官方直连，国内首选）',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        needApiKey: true,
        defaultModel: 'deepseek-chat',
        modelList: [
            { id: 'deepseek-chat', name: 'DeepSeek-V3（通用，推荐）' },
            { id: 'deepseek-reasoner', name: 'DeepSeek-R1（推理强）' },
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash（最新）' },
        ],
        buildBody: (model, messages, { temperature, maxTokens }) => ({
            model, messages, temperature, max_tokens: maxTokens,
        }),
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
    },

    openai: {
        name: 'OpenAI（官方直连）',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        needApiKey: true,
        defaultModel: 'gpt-4o-mini',
        modelList: [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini（性价比最高）' },
            { id: 'gpt-4o', name: 'GPT-4o（能力最强）' },
            { id: 'o1-mini', name: 'o1 Mini（推理模型）' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo（经典）' },
        ],
        buildBody: (model, messages, { temperature, maxTokens }) => ({
            model, messages, temperature, max_tokens: maxTokens,
        }),
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
    },

    dashscope: {
        name: '阿里 DashScope（通义系列）',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        needApiKey: true,
        defaultModel: 'qwen-plus',
        modelList: [
            { id: 'qwen-plus', name: '通义千问 Plus（推荐）' },
            { id: 'qwen-max', name: '通义千问 Max（能力最强）' },
            { id: 'qwen-turbo', name: '通义千问 Turbo（速度最快）' },
        ],
        buildBody: (model, messages, { temperature, maxTokens }) => ({
            model, messages, temperature, max_tokens: maxTokens,
        }),
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
    },

    ollama: {
        name: 'Ollama（本地模型，完全免费）',
        getEndpoint: (cfg) => (cfg.baseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat',
        authHeader: null,
        needApiKey: false,
        defaultModel: 'qwen2.5:7b',
        modelList: [
            { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B（中文好）' },
            { id: 'llama3.1:8b', name: 'Llama 3.1 8B（通用）' },
            { id: 'gemma2:9b', name: 'Gemma 2 9B（轻量）' },
            { id: 'deepseek-r1:7b', name: 'DeepSeek R1（推理强）' },
        ],
        buildBody: (model, messages, { temperature, maxTokens }) => ({
            model,
            messages,
            stream: false,
            options: {
                temperature,
                num_predict: maxTokens,
            },
        }),
        parseResponse: (data) => data.message?.content || '',
    },

    custom: {
        name: '自定义（兼容 OpenAI 格式）',
        getEndpoint: (cfg) => cfg.endpoint || '',
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        needApiKey: true,
        defaultModel: '',
        modelList: [],
        buildBody: (model, messages, { temperature, maxTokens }) => ({
            model, messages, temperature, max_tokens: maxTokens,
        }),
        parseResponse: (data) => data.choices?.[0]?.message?.content || '',
    },
};

// 自定义 Provider 快捷预设
const CUSTOM_PRESETS = [
    {
        label: '硅基流动 SiliconFlow',
        endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        note: '国内速度快，免费额度充足',
    },
    {
        label: '阿里 DashScope',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        note: '通义系列模型',
    },
    {
        label: '本地 LM Studio',
        endpoint: 'http://localhost:1234/v1/chat/completions',
        note: 'LM Studio 本地启动后地址',
    },
    {
        label: 'vLLM 本地服务',
        endpoint: 'http://localhost:8000/v1/chat/completions',
        note: 'vLLM 本地推理服务',
    },
];

const LLMRecRank = {
    PROVIDERS,
    CUSTOM_PRESETS,

    get settings() {
        const saved = localStorage.getItem('links-ai-settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // 旧配置迁移：openrouter → deepseek
                if (parsed.provider === 'openrouter') {
                    parsed.provider = 'deepseek';
                    parsed.deepseekModel = parsed.model || PROVIDERS.deepseek.defaultModel;
                    // 自动存回
                    localStorage.setItem('links-ai-settings', JSON.stringify(parsed));
                }
                return parsed;
            } catch { /* 忽略 */ }
        }
        return {
            provider: 'deepseek',
            // 通用 API Key（deepseek / openai / dashscope / custom 共用）
            apiKey: '',
            // 各 Provider 的模型选择
            deepseekModel: PROVIDERS.deepseek.defaultModel,
            openaiModel: PROVIDERS.openai.defaultModel,
            dashscopeModel: PROVIDERS.dashscope.defaultModel,
            ollamaModel: PROVIDERS.ollama.defaultModel,
            customModel: '',
            // Ollama
            baseUrl: 'http://localhost:11434',
            // Custom
            endpoint: '',
            // 高级
            temperature: 0.4,
            maxTokens: 800,
        };
    },

    set settings(val) {
        localStorage.setItem('links-ai-settings', JSON.stringify(val));
    },

    /**
     * 根据当前配置解析出"实际要调用的 endpoint / headers / model"
     */
    resolveCallConfig() {
        const s = this.settings;
        const provider = PROVIDERS[s.provider];
        if (!provider) throw new Error('未知的 Provider');

        let endpoint, apiKey, model;
        const headers = { 'Content-Type': 'application/json' };

        switch (s.provider) {
            case 'deepseek':
            case 'openai':
            case 'dashscope':
                endpoint = provider.endpoint;
                apiKey = s.apiKey;
                // 每个 Provider 用自己的 model 字段
                const modelField = s.provider + 'Model';  // deepseekModel / openaiModel / dashscopeModel
                model = s[modelField] || provider.defaultModel;
                if (provider.authHeader && apiKey) {
                    headers[provider.authHeader] = provider.authPrefix + apiKey;
                }
                break;
            case 'ollama':
                endpoint = provider.getEndpoint(s);
                model = s.ollamaModel || provider.defaultModel;
                break;
            case 'custom':
                endpoint = provider.getEndpoint(s);
                apiKey = s.apiKey;
                model = s.customModel;
                if (!endpoint) throw new Error('请在设置里填写自定义 API Endpoint');
                if (!model) throw new Error('请在设置里填写模型名');
                if (provider.authHeader && apiKey) {
                    headers[provider.authHeader] = provider.authPrefix + apiKey;
                }
                break;
        }

        if (provider.needApiKey && !apiKey) {
            throw new Error('NO_API_KEY');
        }

        return { endpoint, headers, model, provider };
    },

    buildSystemPrompt(candidates, userQuery) {
        const siteList = candidates.map((c, i) => {
            const s = c.site;
            return `${i + 1}. **${s.name}** (${s.category || s.source || ''})\n   URL: ${s.url}\n   描述: ${s.description || '无'}`;
        }).join('\n\n');

        return `你是一个网站推荐专家。根据用户的需求描述，从下面的候选网站列表中挑选最适合的 3-5 个，并为每个推荐写一句简短的推荐理由。

**用户的需求**：${userQuery}

**候选网站列表**：
${siteList}

**请严格按以下 JSON 格式返回**（不要加任何 Markdown 代码块标记）：
{"recommendations": [{"index": 1, "reason": "为什么推荐这个"}, ...]}

要求：
- index 是候选列表中的序号（从 1 开始）
- reason 控制在 15 字以内
- 只从候选里挑，不要推荐列表外的网站
- 如果没有合适的，返回空数组 {"recommendations": []}`;
    },

    async callLLM(systemPrompt, userMessage) {
        const { endpoint, headers, model, provider } = this.resolveCallConfig();
        const { temperature, maxTokens } = this.settings;

        const body = provider.buildBody(
            model,
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            { temperature, maxTokens }
        );

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let msg = `HTTP ${response.status}`;
            try {
                const err = await response.json();
                msg = err.error?.message || err.message || msg;
            } catch { /* 用 status text */ }
            throw new Error(msg);
        }

        const data = await response.json();
        return provider.parseResponse(data);
    },

    parseRecommendations(text) {
        let clean = text.trim();
        clean = clean.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

        try {
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed.recommendations)) return parsed.recommendations;
        } catch { /* 继续尝试 */ }

        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed.recommendations)) return parsed.recommendations;
            } catch { /* 继续尝试 */ }
        }

        return null;
    },

    /**
     * 测试 Provider 连通性（给设置面板用）
     */
    async testConnection() {
        const { endpoint, headers, model, provider } = this.resolveCallConfig();
        const body = provider.buildBody(
            model,
            [{ role: 'user', content: '回复 ok' }],
            { temperature: 0.1, maxTokens: 10 }
        );
        const response = await fetch(endpoint, {
            method: 'POST', headers, body: JSON.stringify(body),
        });
        return { ok: response.ok, status: response.status };
    },
};

// =====================================================
//  主入口：RAG 搜索管道
// =====================================================
const AISearch = {
    /**
     * 完整搜索流程
     * @param {string} query - 用户自然语言查询
     * @param {object} options
     * @param {boolean} options.forceLocal - 强制只用本地搜索（跳过 LLM）
     */
    async search(query, options = {}) {
        // Step 1：本地粗筛
        const candidates = LocalSearch.search(query, 15, 0.03);
        if (candidates.length === 0) {
            return { success: false, reason: 'local_empty', results: [] };
        }

        // Step 2：判断要不要调 LLM
        const { apiKey } = LLMRecRank.settings;
        const useLLM = !options.forceLocal && apiKey && candidates.length > 3;

        if (!useLLM) {
            // 纯本地模式
            return {
                success: true,
                mode: 'local',
                results: candidates.map(c => ({
                    ...c,
                    reason: null,       // 本地搜索没有理由
                    finalScore: c.localScore,
                })),
            };
        }

        // Step 3：LLM 精排
        try {
            const sysPrompt = LLMRecRank.buildSystemPrompt(candidates, query);
            const llmText = await LLMRecRank.callLLM(sysPrompt, query);
            const recs = LLMRecRank.parseRecommendations(llmText);

            if (!recs || recs.length === 0) {
                // LLM 没返回有效结果，降级到本地
                console.warn('[AISearch] LLM 返回无效，降级到本地搜索');
                return {
                    success: true,
                    mode: 'local',
                    results: candidates.slice(0, 8).map(c => ({
                        ...c, reason: null, finalScore: c.localScore,
                    })),
                };
            }

            // 把 LLM 的推荐映射回候选网站
            const results = recs
                .filter(r => r.index >= 1 && r.index <= candidates.length)
                .map(r => {
                    const cand = candidates[r.index - 1];
                    return {
                        ...cand,
                        reason: r.reason || null,
                        finalScore: cand.localScore * 0.5 + 0.5, // LLM 入选的给个 base 分
                    };
                });

            return {
                success: true,
                mode: 'llm',
                results,
                totalCandidates: candidates.length,
            };
        } catch (err) {
            console.warn('[AISearch] LLM 调用失败，降级到本地搜索:', err.message);
            return {
                success: true,
                mode: 'local',
                reason: err.message,
                results: candidates.slice(0, 8).map(c => ({
                    ...c, reason: null, finalScore: c.localScore,
                })),
            };
        }
    },

    build(allSites) {
        LocalSearch.build(allSites);
    },

    stats() {
        return LocalSearch.stats();
    },
};

window.SemanticSearch = AISearch;
window.AISearch = AISearch;
window.LLMRecRank = LLMRecRank;
window.LocalSearch = LocalSearch;
