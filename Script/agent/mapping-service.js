import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest.json';

export class MappingService {
  constructor(logger) {
    this.logger = logger;
  }

  async ensureMapping(version, outputPath) {
    if (!version) {
      throw new Error('缺少版本号，无法下载映射表');
    }
    if (!outputPath) {
      throw new Error('缺少输出路径，无法保存映射表');
    }

    if (await this.fileExists(outputPath)) {
      this.logger?.info?.(`映射表已存在，跳过下载: ${outputPath}`);
      return { status: 'exists', path: outputPath };
    }

    this.logger?.info?.(`正在下载 ${version} 的映射表 -> ${outputPath}`);

    const manifest = await this.fetchJson(MANIFEST_URL);
    const versionInfo = manifest?.versions?.find?.((item) => item.id === version);
    if (!versionInfo?.url) {
      throw new Error(`版本清单中未找到 ${version}`);
    }

    const versionJson = await this.fetchJson(versionInfo.url);
    const mappingUrl = versionJson?.downloads?.server_mappings?.url;
    if (!mappingUrl) {
      throw new Error(`版本 ${version} 未提供 server_mappings 下载地址`);
    }

    await fs.mkdir(dirname(outputPath), { recursive: true });
    await this.downloadFile(mappingUrl, outputPath);

    this.logger?.debug?.(`映射表下载完成: ${outputPath}`);
    return { status: 'downloaded', path: outputPath };
  }

  async fetchJson(url) {
    const content = await this.fetchText(url);
    try {
      return JSON.parse(content);
    } catch (err) {
      throw new Error(`解析 ${url} JSON 失败: ${err.message}`);
    }
  }

  fetchText(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`请求 ${url} 失败，状态码 ${res.statusCode}`));
            res.resume();
            return;
          }

          res.setEncoding('utf8');
          let rawData = '';
          res.on('data', (chunk) => {
            rawData += chunk;
          });
          res.on('end', () => resolve(rawData));
        })
        .on('error', reject);
    });
  }

  async downloadFile(url, outputPath) {
    await new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`下载 ${url} 失败，状态码 ${res.statusCode}`));
            res.resume();
            return;
          }

          const tmpPath = `${outputPath}.downloading`;
          const totalBytes = Number(res.headers['content-length']) || 0;
          const startTime = Date.now();
          let downloadedBytes = 0;
          let lastLogTime = startTime;

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (now - lastLogTime >= 20_000) {
              lastLogTime = now;
              this.logger?.info?.(
                `映射下载进度: ${formatPercent(downloadedBytes, totalBytes)} ${formatSpeed(downloadedBytes, now - startTime)} 预计${formatEta(downloadedBytes, totalBytes, now - startTime)}`
              );
            }
          });

          const fileStream = createWriteStream(tmpPath);
          pipeline(res, fileStream)
            .then(async () => {
              const now = Date.now();
              this.logger?.info?.(
                `映射下载进度: 100% ${formatSpeed(downloadedBytes, now - startTime)} 预计0秒`
              );
              await fs.rename(tmpPath, outputPath);
              resolve();
            })
            .catch(async (err) => {
              try {
                await fs.unlink(tmpPath);
              } catch (_) {
                // ignore
              }
              reject(err);
            });
        })
        .on('error', reject);
    });
  }

  async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

function formatPercent(downloaded, total) {
  if (total > 0) {
    const pct = Math.min(100, Math.round((downloaded * 100) / total));
    return `${pct}%`;
  }
  return '??%';
}

function formatSpeed(downloaded, elapsedMillis) {
  if (elapsedMillis <= 0) {
    return '0KB/s';
  }
  const bytesPerSec = downloaded / (elapsedMillis / 1000);
  if (bytesPerSec < 1024) {
    return `${bytesPerSec.toFixed(0)}B/s`;
  }
  const kbPerSec = bytesPerSec / 1024;
  if (kbPerSec < 1024) {
    return `${kbPerSec.toFixed(0)}KB/s`;
  }
  const mbPerSec = kbPerSec / 1024;
  if (mbPerSec < 1024) {
    return `${mbPerSec.toFixed(1)}MB/s`;
  }
  const gbPerSec = mbPerSec / 1024;
  return `${gbPerSec.toFixed(2)}GB/s`;
}

function formatEta(downloaded, total, elapsedMillis) {
  if (total <= 0 || downloaded <= 0) {
    return '未知';
  }
  const bytesPerSec = downloaded / (elapsedMillis / 1000 || 1);
  if (bytesPerSec <= 0) {
    return '未知';
  }
  const remaining = total - downloaded;
  if (remaining <= 0) {
    return '0秒';
  }
  const seconds = Math.round(remaining / bytesPerSec);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}分钟${secs}秒`;
  }
  return `${secs}秒`;
}

