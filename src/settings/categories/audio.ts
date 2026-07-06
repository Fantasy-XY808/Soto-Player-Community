import type { SettingCategory } from "@/types/settings-schema";
import DeviceSelector from "@/components/settings/custom/DeviceSelector.vue";
import EqualizerControl from "@/components/settings/custom/EqualizerControl.vue";
import SuperResParamsControl from "@/components/settings/custom/SuperResParamsControl.vue";
import BassEnhancerControl from "@/components/settings/custom/BassEnhancerControl.vue";
import StereoWidenerControl from "@/components/settings/custom/StereoWidenerControl.vue";
import LoudnessNormalizerControl from "@/components/settings/custom/LoudnessNormalizerControl.vue";
import NeuralUpsampleControl from "@/components/settings/custom/NeuralUpsampleControl.vue";
import SpatialAudioControl from "@/components/settings/custom/SpatialAudioControl.vue";
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
        {
          key: "audioSuperResolution",
          type: "custom",
          component: SuperResParamsControl,
          fullWidth: true,
        },
        {
          key: "bassEnhancer",
          type: "custom",
          component: BassEnhancerControl,
          fullWidth: true,
        },
        {
          key: "stereoWidener",
          type: "custom",
          component: StereoWidenerControl,
          fullWidth: true,
        },
        {
          key: "loudnessNormalizer",
          type: "custom",
          component: LoudnessNormalizerControl,
          fullWidth: true,
        },
        {
          key: "neuralUpsample",
          type: "custom",
          component: NeuralUpsampleControl,
          fullWidth: true,
          tag: { text: "Beta" },
        },
        {
          key: "spatialAudio",
          type: "custom",
          component: SpatialAudioControl,
          fullWidth: true,
          tag: { text: "Beta" },
        },
      ],
    },
  ],
};

export default audioCategory;
