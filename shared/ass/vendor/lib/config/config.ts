/**
 * Browser shim of package/src/lib/config/config.ts — same singleton API the
 * vendored generators import; buildAssContent sets it per call.
 */
type ConfigType = { width: number; height: number; frameRate?: number }

class Config {
  private config: ConfigType = { width: 1280, height: 720 }

  getConfig() {
    return this.config
  }

  updateConfig(newConfig: Partial<ConfigType>) {
    if (newConfig.width !== undefined) this.config.width = newConfig.width
    if (newConfig.height !== undefined) this.config.height = newConfig.height
    if (newConfig.frameRate !== undefined) this.config.frameRate = newConfig.frameRate
  }
}

const configInstance = new Config()
export default configInstance
