/**
 * 图片工具函数 — 不再依赖 @google/genai
 */

/**
 * 将 File 对象 **或** 已有的字符串（data URI / 相对 URL / 绝对 URL）转换为可直接放进请求体的字符串。
 *
 * 行为（v3 GCS 之后调整）：
 *   - File           → FileReader 转 data URI（前端只能拿 File 字节这一条路）
 *   - data URI       → 原样返回
 *   - 其他字符串 URL → 原样返回（不再 fetch）
 *
 * 为什么 string URL 不再 fetch：
 *   storage backend 切到 GCS（presigned URL）后，浏览器从 localhost:5173 fetch
 *   storage.googleapis.com 会被 CORS 直接挡住（TypeError: Failed to fetch），
 *   被 generateImage 的 catch 吞掉变成"phase1 静默失败"。
 *   修复策略：URL 字节让 Python 侧服务器拉（tbfirst-ai-python/app/core/image_uri.py
 *   的 decode_image_to_inline 已经能解 data: / http(s):// / 相对路径），前端只负
 *   责把字符串原封透传到后端 referenceImages 数组里。即使本地存储模式下 /static/
 *   URL 也走同一逻辑——多一次网关→image:8102 的拉取，比浏览器 fetch 多 1 跳但永远不会撞 CORS。
 */
export const fileToDataUri = async (fileOrUrl: File | string): Promise<string> => {
    if (fileOrUrl instanceof File) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(fileOrUrl);
        });
    }
    if (typeof fileOrUrl !== 'string') {
        throw new TypeError('[fileToDataUri] 不支持的入参类型：' + typeof fileOrUrl);
    }
    // data URI 与外部 URL 一律原样透传，由后端 decode_image_to_inline 统一解析
    return fileOrUrl;
};

/**
 * 兼容旧代码 — 返回 data URI 字符串而非 Part 对象
 */
export const getDataPart = async (fileOrUrl: File | string): Promise<string> => {
    return fileToDataUri(fileOrUrl);
};
