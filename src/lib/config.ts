/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import configJson from '../../config.json'; // build-time JSON
import { db } from './db';
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
  epg?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: Record<string, Omit<ApiSite, 'key'>>;
  custom_category?: { name?: string; type: 'movie' | 'tv'; query: string }[];
  lives?: Record<string, LiveCfg>;
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

// ----------------------
// In-memory cache
let cachedConfig: AdminConfig;

// ----------------------
// Initialize config from JSON
async function getInitConfig(): Promise<AdminConfig> {
  const cfgFile: ConfigFileStruct = configJson as ConfigFileStruct;

  const adminConfig: AdminConfig = {
    ConfigFile: JSON.stringify(cfgFile),
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。',
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
    LiveConfig: [], // ✅ initialize LiveConfig
  };

  // Add API sources
  Object.entries(cfgFile.api_site || {}).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  // Add custom categories
  (cfgFile.custom_category || []).forEach((c) => {
    adminConfig.CustomCategories.push({
      name: c.name || c.query,
      type: c.type,
      query: c.query,
      from: 'config',
      disabled: false,
    });
  });

  // Add live sources
  Object.entries(cfgFile.lives || {}).forEach(([key, live]) => {
    adminConfig.LiveConfig!.push({
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

  // Populate users
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

  return adminConfig;
}

// ----------------------
// Refine / merge runtime config
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct = {} as ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch {}

  // Merge API sites
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );
  Object.entries(fileConfig.api_site || {}).forEach(([key, site]) => {
    const existing = currentApiSites.get(key);
    if (existing) {
      existing.name = site.name;
      existing.api = site.api;
      existing.detail = site.detail;
      existing.from = 'config';
    } else {
      currentApiSites.set(key, { key, name: site.name, api: site.api, detail: site.detail, from: 'config', disabled: false });
    }
  });
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // Merge custom categories
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );
  (fileConfig.custom_category || []).forEach((c) => {
    const key = c.query + c.type;
    const existing = currentCustomCategories.get(key);
    if (existing) {
      existing.name = c.name;
      existing.type = c.type;
      existing.query = c.query;
      existing.from = 'config';
    } else {
      currentCustomCategories.set(key, { name: c.name || c.query, type: c.type, query: c.query, from: 'config', disabled: false });
    }
  });
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  // Merge live sources
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l])
  );
  Object.entries(fileConfig.lives || {}).forEach(([key, live]) => {
    const existing = currentLives.get(key);
    if (existing) {
      existing.name = live.name;
      existing.url = live.url;
      existing.ua = live.ua;
      existing.epg = live.epg;
    } else {
      currentLives.set(key, { key, name: live.name, url: live.url, ua: live.ua, epg: live.epg, channelNumber: 0, from: 'config', disabled: false });
    }
  });
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
}

// ----------------------
// Get config with caching & DB fallback
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
    await db.saveAdminConfig(adminConfig);
  }

  cachedConfig = configSelfCheck(adminConfig);
  return cachedConfig;
}

// ----------------------
// Self-check for safety & dedup
export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  if (!adminConfig.UserConfig) adminConfig.UserConfig = { Users: [] };
  if (!adminConfig.UserConfig.Users) adminConfig.UserConfig.Users = [];
  if (!adminConfig.SourceConfig) adminConfig.SourceConfig = [];
  if (!adminConfig.CustomCategories) adminConfig.CustomCategories = [];
  if (!adminConfig.LiveConfig) adminConfig.LiveConfig = [];

  const ownerUser = process.env.USERNAME;

  // Users dedup & owner fix
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((u) => {
    if (seenUsernames.has(u.username)) return false;
    seenUsernames.add(u.username);
    return true;
  });
  const originOwnerCfg = adminConfig.UserConfig.Users.find((u) => u.username === ownerUser);
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((u) => u.username !== ownerUser);
  adminConfig.UserConfig.Users.forEach((u) => { if (u.role === 'owner') u.role = 'user'; });
  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis || undefined,
    tags: originOwnerCfg?.tags || undefined,
  });

  // Dedup SourceConfig
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((s) => {
    if (seenSourceKeys.has(s.key)) return false;
    seenSourceKeys.add(s.key);
    return true;
  });

  // Dedup CustomCategories
  const seenCustomKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter((c) => {
    const key = c.query + c.type;
    if (seenCustomKeys.has(key)) return false;
    seenCustomKeys.add(key);
    return true;
  });

  // Dedup LiveConfig
  const seenLiveKeys = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.filter((l) => {
    if (seenLiveKeys.has(l.key)) return false;
    seenLiveKeys.add(l.key);
    return true;
  });

  return adminConfig;
}

// ----------------------
// Reset config
export async function resetConfig() {
  const adminConfig = await getInitConfig();
  cachedConfig = adminConfig;
  await db.saveAdminConfig(adminConfig);
}

// ----------------------
// Optional helpers
export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}

export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);
  if (!user) return allApiSites;

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) return allApiSites;

  if (userConfig.enabledApis && userConfig.enabledApis.length > 0) {
    const enabledSet = new Set(userConfig.enabledApis);
    return allApiSites.filter((s) => enabledSet.has(s.key));
  }

  if (userConfig.tags && userConfig.tags.length > 0 && config.UserConfig.Tags) {
    const enabledApisFromTags = new Set<string>();
    userConfig.tags.forEach((tag) => {
      const tagCfg = config.UserConfig.Tags?.find((t) => t.name === tag);
      tagCfg?.enabledApis?.forEach((apiKey) => enabledApisFromTags.add(apiKey));
    });
    if (enabledApisFromTags.size > 0) {
      return allApiSites.filter((s) => enabledApisFromTags.has(s.key));
    }
  }

  return allApiSites;
}
