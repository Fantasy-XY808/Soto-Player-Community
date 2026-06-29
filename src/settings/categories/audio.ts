import type { SettingCategory } from "@/types/settings-schema";
import DeviceSelector from "@/components/settings/custom/DeviceSelector.vue";
import EqualizerControl from "@/components/settings/custom/EqualizerControl.vue";
import IconLucideAudioWaveform from "~icons/lucide/audio-waveform";

const audioCategory: SettingCategory = {
  id: "audio",
  icon: IconLucideAudioWaveform,
  sections: [
    {
      id: "audioQuality",
      items: [
        {
          key: "songLevel",
          type: "select",
          binding: { store: "settings", path: "player.songLevel" },
          options: [
            { value: "lq", labelKey: "settings.songLevel.lq" },
            { value: "sq", labelKey: "settings.songLevel.sq" },
            { value: "hq", labelKey: "settings.songLevel.hq" },
            { value: "lossless", labelKey: "settings.songLevel.lossless" },
            { value: "hi-res", labelKey: "settings.songLevel.hi-res" },
            { value: "jyeffect", labelKey: "settings.songLevel.jyeffect" },
            { value: "sky", labelKey: "settings.songLevel.sky" },
            { value: "jymaster", labelKey: "settings.songLevel.jymaster" },
          ],
          defaultValue: "hq",
        },
        {
          key: "loudnessNormalization",
          type: "switch",
          binding: { store: "settings", path: "system.player.loudnessNormalization" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
      ],
    },
    {
      id: "device",
      items: [
        {
          key: "outputDevice",
          type: "custom",
          component: DeviceSelector,
        },
        {
          key: "pauseOnDeviceSwitch",
          type: "switch",
          binding: { store: "settings", path: "player.pauseOnDeviceSwitch" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "enhancerEntry",
      items: [
        {
          key: "equalizer",
          type: "custom",
          component: EqualizerControl,
          fullWidth: true,
        },
      ],
    },
    {
      id: "audioSuperRes",
      items: [
        {
          key: "audioSuperResolutionEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.player.audioSuperResolution.enabled" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
        {
          key: "audioSuperResolutionBackend",
          type: "select",
          binding: { store: "settings", path: "system.player.audioSuperResolution.backend" },
          defaultValue: 0,
          options: [
            { value: 0, labelKey: "settings.audioSuperResolutionBackend.cpu" },
            { value: 1, labelKey: "settings.audioSuperResolutionBackend.gpu" },
            { value: 2, labelKey: "settings.audioSuperResolutionBackend.npu" },
          ],
        },
      ],
    },
  ],
};

export default audioCategory;
