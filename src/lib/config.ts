/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, no-console */

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
  api_site?: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: {
    [key: string]: LiveCfg;
  };
}

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

// 自动加载 config.json
function loadConfigFile(): string {
  const configPath = path.resolve(process.cwd(), 'config.json');
  try {
    return fs.readFileSync(configPath, 'utf-8');
  } catch (e) {
    console.error('加载 config.json 失败:', e);
    return '{}';
  }
}

// 补充管理员配置
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch (e) {
    console.error('解析 ConfigFile 失败:', e);
    fileConfig = {} as ConfigFileStruct;
  }

  // 合并 API 源
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      currentApiSites.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });

  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 合并自定义分类
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = currentCustomCategories.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type)
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  // 合并直播源
  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l])
  );

  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = site.name;
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
    } else {
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
    }
  });

  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
}

// 初始化配置
async function getInitConfig(
  configFile: string = loadConfigFile(),
  subConfig: { URL: string; AutoUpdate: boolean; LastCheck: string } = {
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  }
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = JSON.parse(configFile) as ConfigFileStruct;
  } catch {
    cfgFile = {} as ConfigFileStruct;
  }

  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscribtion: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
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

  // 补充用户信息
  let userNames: string[] = [];
  try {
    userNames = await db.getAllUsers();
  } catch (e) {
    console.error('获取用户列表失败:', e);
  }

  const allUsers = userNames
    .filter((u) => u !== process.env.USERNAME)
    .map((u) => ({ username: u, role: 'user', banned: false }));

  allUsers.unshift({ username: process.env.USERNAME!, role: 'owner', banned: false });
  adminConfig.UserConfig.Users = allUsers as any;

  // 从配置文件中补充 API、自定义分类、直播源
  Object.entries(cfgFile.api_site || []).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  Object.entries(cfgFile.lives || []).forEach(([key, live]) => {
    adminConfig.LiveConfig.push({
      key,
      name: live.name,
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });

  return adminConfig;
}

// 获取管理员配置
export async function getConfig(): Promise<AdminConfig> {
  if (cachedConfig) return cachedConfig;

  let adminConfig: AdminConfig | null = null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('获取管理员配置失败:', e);
  }

  if (!adminConfig) adminConfig = await getInitConfig();
  adminConfig = configSelfCheck(adminConfig);
  cachedConfig = adminConfig;
  await db.saveAdminConfig(cachedConfig);
  return cachedConfig;
}

// 自检配置
export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  if (!adminConfig.UserConfig) adminConfig.UserConfig = { Users: [] };
  if (!Array.isArray(adminConfig.UserConfig.Users)) adminConfig.UserConfig.Users = [];
  if (!Array.isArray(adminConfig.SourceConfig)) adminConfig.SourceConfig = [];
  if (!Array.isArray(adminConfig.CustomCategories)) adminConfig.CustomCategories = [];
  if (!Array.isArray(adminConfig.LiveConfig)) adminConfig.LiveConfig = [];

  const ownerUser = process.env.USERNAME;
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) return false;
    seenUsernames.add(user.username);
    return true;
  });

  const originOwnerCfg = adminConfig.UserConfig.Users.find((u) => u.username === ownerUser);
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((u) => u.username !== ownerUser);
  adminConfig.UserConfig.Users.forEach((u) => {
    if (u.role === 'owner') u.role = 'user';
  });

  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis,
    tags: originOwnerCfg?.tags,
  });

  const dedup = <T extends { key: string }>(arr: T[]) => Array.from(new Map(arr.map((a) => [a.key, a])).values());
  adminConfig.SourceConfig = dedup(adminConfig.SourceConfig);
  adminConfig.LiveConfig = dedup(adminConfig.LiveConfig);

  const seenCategories = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter((c) => {
    const key = c.query + c.type;
    if (seenCategories.has(key)) return false;
    seenCategories.add(key);
    return true;
  });

  return adminConfig;
}

// 重置配置
export async function resetConfig() {
  let originConfig: AdminConfig | null = null;
  try {
    originConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('获取管理员配置失败:', e);
  }
  if (!originConfig) originConfig = {} as AdminConfig;

  const adminConfig = await getInitConfig(originConfig.ConfigFile, originConfig.ConfigSubscribtion);
  cachedConfig = adminConfig;
  await db.saveAdminConfig(adminConfig);
}

// 获取缓存时间
export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

// 获取可用 API
export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);
  if (!user) return allApiSites;

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) return allApiSites;

  if (userConfig.enabledApis?.length) {
    const userApiSet = new Set(userConfig.enabledApis);
    return allApiSites.filter((s) => userApiSet.has(s.key));
  }

  if (userConfig.tags?.length && config.UserConfig.Tags) {
    const enabledApisFromTags = new Set<string>();
    userConfig.tags.forEach((tagName) => {
      const tagCfg = config.UserConfig.Tags?.find((t) => t.name === tagName);
      tagCfg?.enabledApis?.forEach((apiKey) => enabledApisFromTags.add(apiKey));
    });
    if (enabledApisFromTags.size > 0) {
      return allApiSites.filter((s) => enabledApisFromTags.has(s.key));
    }
  }

  return allApiSites;
}

// 设置缓存配置
export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}
