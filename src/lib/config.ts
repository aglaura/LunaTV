/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { AdminConfig } from './admin.types';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface LiveCfg {
  name: string;
  url: string;
  ua?: string;
  epg?: string; // 节目单
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: Record<string, ApiSite>;
  custom_category?: { name?: string; type: 'movie' | 'tv'; query: string }[];
  lives?: Record<string, LiveCfg>;
}

// 默认搜索与详情配置
export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 内存缓存
let cachedConfig: AdminConfig;

/**
 * 从 adminConfig.ConfigFile 补充源信息、自定义分类和直播源
 */
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch {
    fileConfig = {} as ConfigFileStruct;
  }

  // 处理 api_site
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map((adminConfig.SourceConfig || []).map((s) => [s.key, s]));
  apiSitesFromFile.forEach(([key, site]) => {
    currentApiSites.set(key, {
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 处理 custom_category
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );
  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    currentCustomCategories.set(key, {
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  // 处理 lives
  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map((adminConfig.LiveConfig || []).map((l) => [l.key, l]));
  livesFromFile.forEach(([key, site]) => {
    currentLives.set(key, {
      key,
      name: site.name,
      url: site.url,
      ua: site.ua,
      epg: site.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
}

/**
 * 初始化 AdminConfig：优先读取 config.json
 */
async function getInitConfig(
  configFile: string = '',
  subConfig: { URL: string; AutoUpdate: boolean; LastCheck: string } = {
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  }
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct = {} as ConfigFileStruct;

  // 尝试读取项目根目录的 config.json
  const configPath = path.resolve(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      cfgFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error('config.json 解析失败:', e);
    }
  } else if (configFile) {
    try {
      cfgFile = JSON.parse(configFile);
    } catch {}
  }

  const adminConfig: AdminConfig = {
    ConfigFile: JSON.stringify(cfgFile),
    ConfigSubscribtion: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源。',
      SearchDownstreamMaxPage: Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: cfgFile.cache_time || 7200,
      DoubanProxyType: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter: process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
    },
    UserConfig: { Users: [] },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  return refineConfig(adminConfig);
}

/**
 * 获取管理员配置
 */
export async function getConfig(): Promise<AdminConfig> {
  if (cachedConfig) return cachedConfig;

  let adminConfig: AdminConfig | null = null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('获取管理员配置失败:', e);
  }

  if (!adminConfig) {
    adminConfig = await getInitConfig();
  }

  adminConfig = configSelfCheck(adminConfig);
  cachedConfig = adminConfig;
  db.saveAdminConfig(cachedConfig);

  return cachedConfig;
}

/**
 * 基础自检与去重
 */
export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  if (!adminConfig.UserConfig) adminConfig.UserConfig = { Users: [] };
  if (!adminConfig.SourceConfig) adminConfig.SourceConfig = [];
  if (!adminConfig.CustomCategories) adminConfig.CustomCategories = [];
  if (!adminConfig.LiveConfig) adminConfig.LiveConfig = [];

  // 去重示例（用户、源、自定义分类、直播）
  const seenUsers = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((u) => {
    if (seenUsers.has(u.username)) return false;
    seenUsers.add(u.username);
    return true;
  });

  const seenKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((s) => {
    if (seenKeys.has(s.key)) return false;
    seenKeys.add(s.key);
    return true;
  });

  const seenCat = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter(
    (c) => !seenCat.has(c.query + c.type) && seenCat.add(c.query + c.type)
  );

  const seenLive = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.filter(
    (l) => !seenLive.has(l.key) && seenLive.add(l.key)
  );

  return adminConfig;
}

/**
 * 重置配置
 */
export async function resetConfig() {
  const originConfig = (await db.getAdminConfig()) || ({} as AdminConfig);
  const adminConfig = await getInitConfig(originConfig.ConfigFile, originConfig.ConfigSubscribtion);
  cachedConfig = adminConfig;
  await db.saveAdminConfig(adminConfig);
}

/**
 * 获取缓存时间
 */
export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

/**
 * 获取可用 API 源
 */
export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);

  if (!user) return allApiSites;

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) return allApiSites;

  if (userConfig.enabledApis?.length) {
    const allowed = new Set(userConfig.enabledApis);
    return allApiSites.filter((s) => allowed.has(s.key));
  }

  return allApiSites;
}

/**
 * 设置内存缓存
 */
export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}
