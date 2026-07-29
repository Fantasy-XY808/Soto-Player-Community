import type { SettingCategory } from "@/types/settings-schema";
import McpStatusCard from "@/components/settings/custom/McpStatusCard.vue";
import McpConfigDialog from "@/components/settings/custom/McpConfigDialog.vue";
import AiModelConfig from "@/components/settings/custom/AiModelConfig.vue";
import IconLucideSparkles from "~icons/lucide/sparkles";

const aiIntegrationCategory: SettingCategory = {
  id: "aiIntegration",
  icon: IconLucideSparkles,
  sections: [
    {
      id: "mcpServer",
      tag: { text: "Beta", type: "info" },
      items: [
        {
          key: "mcpEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.aiIntegration.mcpEnabled" },
          defaultValue: false,
          children: [
            {
              key: "mcpPort",
              type: "number",
              binding: { store: "settings", path: "aiIntegration.mcpPort" },
              min: 1024,
              max: 65535,
              defaultValue: 14559,
              advanced: true,
            },
            {
              key: "mcpStatusCard",
              type: "custom",
              component: McpStatusCard,
              fullWidth: true,
              keywords: ["settings.mcp.running", "settings.mcp.stopped", "settings.mcp.restart"],
              advanced: true,
            },
            {
              key: "mcpConfigDialog",
              type: "custom",
              component: McpConfigDialog,
              fullWidth: true,
              keywords: [
                "settings.mcp.configDetails",
                "settings.mcp.inject",
                "settings.mcp.endpoint",
              ],
              advanced: true,
            },
          ],
        },
      ],
    },
    {
      id: "aiModel",
      tag: { text: "Beta", type: "info" },
      items: [
        {
          key: "aiModelConfig",
          type: "custom",
          component: AiModelConfig,
          fullWidth: true,
          keywords: [
            "settings.aiModel.add",
            "settings.aiModel.editModel",
            "settings.aiModel.hint",
          ],
        },
      ],
    },
  ],
};

export default aiIntegrationCategory;
