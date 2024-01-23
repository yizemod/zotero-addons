import { Sources, autoSource, currentSource, setAutoSource } from "../utils/configuration";
import { compareVersion } from "../utils/utils";
const { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
const { XPIDatabase } = ChromeUtils.import("resource://gre/modules/addons/XPIDatabase.jsm");


/**
 * Datastruct of Remote AddonInfo
 * Copy from https://github.com/zotero-chinese/zotero-plugins
 */
export interface AddonInfo {
  /**
   * 插件名称
   */
  name: string;
  /**
   * 插件仓库
   *
   * 例如：northword/zotero-format-metadata
   *
   * 注意前后均无 `/`
   */
  repo: string;
  /**
   * 插件的发布地址信息
   */
  releases: Array<{
    /**
     * 当前发布版对应的 Zotero 版本
     */
    targetZoteroVersion: string;
    /**
     * 当前发布版对应的下载通道
     *
     * `latest`：最新正式发布；
     * `pre`：最新预发布；
     * `string`：发布对应的 `git.tag_name`；
     * 注意 `git.tag_name` 有的有 `v` 而有的没有，可以通过发布链接来判断
     * 程序执行后，`tagName` 将替换为实际的 `git.tag_name`
     */
    tagName: "latest" | "pre" | string;
    /**
     * 插件 ID，自 XPI 中提取
     */
    id?: string;

    /**
     * 插件版本，自 XPI 中提取
     */
    xpiVersion?: string;

    xpiDownloadUrl?: {
      github: string;
      gitee?: string;
      ghProxy?: string;
      jsdeliver?: string;
      kgithub?: string;
    };
    releaseDate?: string;
    downloadCount?: number;
    assetId?: number;
  }>;

  description?: string;
  star?: number;
  watchers?: number;
  author?: {
    name: string;
    url: string;
    avatar: string;
  };
}

/**
 * Extract download urls of xpi file from AddonInfo 
 * @param addonInfo AddonInfo specified
 * @returns Download urls (Adapted to current Zotero version)
 */
export function xpiDownloadUrls(addonInfo: AddonInfo) {
  const z7DownloadUrls = addonReleaseInfo(addonInfo)?.xpiDownloadUrl;
  if (!z7DownloadUrls) { return []; }
  const sourceID = currentSource().id === "source-auto" ? autoSource()?.id : currentSource().id;
  switch (sourceID) {
    case "source-zotero-chinese-github":
      return [z7DownloadUrls.github, z7DownloadUrls.gitee, z7DownloadUrls.jsdeliver, z7DownloadUrls.ghProxy, z7DownloadUrls.kgithub].filter(e => e);
    case "source-zotero-chinese-ghproxy":
      return [z7DownloadUrls.ghProxy, z7DownloadUrls.github, z7DownloadUrls.gitee, z7DownloadUrls.jsdeliver, z7DownloadUrls.kgithub].filter(e => e);
    case "source-zotero-chinese-jsdelivr":
      return [z7DownloadUrls.jsdeliver, z7DownloadUrls.github, z7DownloadUrls.gitee, z7DownloadUrls.ghProxy, z7DownloadUrls.kgithub].filter(e => e);
    case "source-zotero-chinese-gitee":
      return [z7DownloadUrls.gitee, z7DownloadUrls.github, z7DownloadUrls.jsdeliver, z7DownloadUrls.ghProxy, z7DownloadUrls.kgithub].filter(e => e);
    default:
      return [z7DownloadUrls.github, z7DownloadUrls.gitee, z7DownloadUrls.jsdeliver, z7DownloadUrls.ghProxy, z7DownloadUrls.kgithub].filter(e => e);
  }
}

/**
 * Extract add-on release information from AddonInfo
 * @param addonInfo AddonInfo
 * @returns AddonInfo.releases (Adapted to current Zotero version)
 */
export function addonReleaseInfo(addonInfo: AddonInfo) {
  const release = addonInfo.releases.find(release => release.targetZoteroVersion === (ztoolkit.isZotero7() ? "7" : "6"));
  if ((release?.xpiDownloadUrl?.github?.length ?? 0) === 0) { return; }
  return release
}

/**
 * Extract add-on xpi release time from AddonInfo 
 * @param addonInfo AddonInfo
 * @returns AddonInfo.releases.releaseDate string with yyyy/MM/dd hh:mm:ss format (Adapted to current Zotero version)
 */
export function addonReleaseTime(addonInfo: AddonInfo) {
  const inputDate = new Date(addonReleaseInfo(addonInfo)?.releaseDate ?? "");
  if (inputDate) {
    const year = inputDate.getFullYear();
    const month = String(inputDate.getMonth() + 1).padStart(2, '0');
    const day = String(inputDate.getDate()).padStart(2, '0');
    const hours = String(inputDate.getHours()).padStart(2, '0');
    const minutes = String(inputDate.getMinutes()).padStart(2, '0');
    const seconds = String(inputDate.getSeconds()).padStart(2, '0');
    const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
    return formattedDate;
  }
}


/**
 * Extract and filter local addon obj from AddonInfo
 * @param addonInfos AddonInfo array
 * @returns [AddonInfo, addon][] pair which addon installed
 */
export async function relatedAddons(addonInfos: AddonInfo[]) {
  const addons: [AddonInfo, any][] = [];
  for (const addon of await AddonManager.getAllAddons()) {
    if (!addon.id) { continue; }
    const relateAddon = addonInfos.find(addonInfo => {
      if (addonReleaseInfo(addonInfo)?.id === addon.id) { return true; }
      if (addonInfo.name.length > 0 && addonInfo.name === addon.name) { return true; }
      if (addon.homepageURL && addon.homepageURL.includes(addonInfo.repo)) { return true; }
      if (addon.updateURL && addon.updateURL.includes(addonInfo.repo)) { return true; }
      return false;
    });
    if (relateAddon) {
      addons.push([relateAddon, addon]);
    }
  }
  return addons;
}

/**
 * Addon install status
 */
export enum InstallStatus {
  unknown = 0,
  notInstalled = 1,
  normal = 2,
  updatable = 3,
  disabled = 4,
  incompatible = 5,
  pendingUninstall = 6,
}

/**
 * Get addon install status
 * @param addonInfo AddonInfo
 * @param relateAddon AddonInfo and its related local addon. If passed undefined, InstallStatus.unknown will return
 * @returns InstallStatus
 */
export async function addonInstallStatus(addonInfo: AddonInfo, relateAddon?: [AddonInfo, any]) {
  if (relateAddon) { // has local addon
    if (relateAddon[1]) { 
      const dbAddon = XPIDatabase.getAddons().filter((addon: any) => addon.id === relateAddon[1].id);
      if (dbAddon.length > 0 && dbAddon[0].pendingUninstall) { // deleted
        return InstallStatus.pendingUninstall;
      } else { // exist
        if (relateAddon[1].appDisabled || !relateAddon[1].isCompatible || !relateAddon[1].isPlatformCompatible) {
          return InstallStatus.incompatible;
        } else if (relateAddon[1].userDisabled) {
          return InstallStatus.disabled;
        } else if (addonCanUpdate(relateAddon[0], relateAddon[1])) {
          return InstallStatus.updatable;
        } else {
          return InstallStatus.normal;
        }
      }
    } else { // incompatible
      return InstallStatus.incompatible;
    }
  } else { // not found
    return addonReleaseInfo(addonInfo)?.id ? InstallStatus.notInstalled : InstallStatus.unknown;
  }
}

  /**
   * Check addon can upgrade
   * @param addonInfo AddonInfo
   * @param addon local addon
   * @returns bool
   */
  export function addonCanUpdate(addonInfo: AddonInfo, addon: any) {
    const version = addonReleaseInfo(addonInfo)?.xpiVersion;
    if (!version || !addon.version) { return false; }
    return compareVersion(addon.version, version) < 0;
  }


class AddonInfoAPI {
  /**
   * Fetch AddonInfo from url
   * @param url url to fetch AddonInfo JSON
   * @param timeout set timeout if specified
   * @param onTimeoutCallback timeout callback if specified timeout
   * @returns AddonInfo[]
   */
  static async fetchAddonInfos(url: string, timeout?: number, onTimeoutCallback?: VoidFunction): Promise<AddonInfo[]> {
    ztoolkit.log(`fetch addon infos from ${url}`);
    try {
      const options: { timeout?: number } = {};
      if (timeout) {
        options.timeout = timeout;
      }
      const response = await Zotero.HTTP.request("GET", url, options);
      const addons = JSON.parse(response.response) as AddonInfo[];
      const validAddons = addons.filter(addon => addonReleaseInfo(addon));
      return validAddons.sort((a: AddonInfo, b: AddonInfo) => {
        return (b.star ?? 0) - (a.star ?? 0);
      });
    } catch (error) {
      ztoolkit.log(`fetch fetchAddonInfos from ${url} failed: ${error}`);
      if (error instanceof (Zotero.HTTP as any).TimeoutException) {
        onTimeoutCallback?.();
      }
    }
    return [];
  }
}

export class AddonInfoManager {
  static shared = new AddonInfoManager();

  private constructor() { }

  /**
   * Get AddonInfos from memory
   */
  get addonInfos() {
    const url = currentSource().api;
    if (!url) { return []; }
    if (url in this.sourceInfos && (new Date().getTime() - this.sourceInfos[url][0].getTime()) < 12 * 60 * 60 * 1000) {
      return this.sourceInfos[url][1];
    }
    return [];
  }

  private sourceInfos: { [key: string]: [Date, AddonInfo[]] } = {};
  /**
   * Fetch AddonInfos from current selected source
   * @param forceRefresh force fetch
   * @returns AddonInfo[]
   */
  async fetchAddonInfos(forceRefresh = false) {
    const source = currentSource();
    if (source.id === "source-auto" && !source.api) {
      return await AddonInfoManager.autoSwitchAvaliableApi();
    }
    const url = source.api;
    if (!url) { return []; }
    // 不在刷新，且不需要强制刷新
    if (!forceRefresh && this.addonInfos) {
      return this.addonInfos;
    }
    const infos = await AddonInfoAPI.fetchAddonInfos(url, 5000);
    if (infos.length > 0) {
      this.sourceInfos[url] = [new Date(), infos];
    }
    return this.addonInfos;
  }

  /**
   * Switch to a connectable source
   * @param timeout Check next source if current source exceed timeout 
   * @returns AddonInfos from automatic source
   */
  static async autoSwitchAvaliableApi(timeout: number = 3000) {
    for (const source of Sources) {
      if (!source.api) { continue; }
      const infos = await AddonInfoAPI.fetchAddonInfos(source.api, timeout, () => {
        ztoolkit.log(`check source from ${source.api} timeout!`);
      });
      if (infos.length > 0) {
        this.shared.sourceInfos[source.api] = [new Date(), infos];
        setAutoSource(source);
        ztoolkit.log(`switch to ${source.id} automatically`);
        return infos;
      }
    }
    return [];
  }
}