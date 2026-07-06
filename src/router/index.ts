import { createRouter, createWebHashHistory } from "vue-router";
import { runIdle } from "@/services/performanceOptimization";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/onboarding",
      name: "onboarding",
      component: () => import("@/pages/Onboarding.vue"),
    },
    {
      path: "/",
      component: () => import("@/layouts/MainLayout.vue"),
      children: [
        {
          path: "",
          name: "home",
          component: () => import("@/pages/Home.vue"),
        },
        {
          path: "library",
          name: "library",
          component: () => import("@/pages/Library.vue"),
        },
        {
          path: "liked",
          name: "liked",
          component: () => import("@/pages/Liked.vue"),
        },
        {
          path: "history",
          name: "history",
          component: () => import("@/pages/History.vue"),
        },
        {
          path: "report",
          name: "music-report",
          component: () => import("@/pages/MusicReport.vue"),
        },
        {
          path: "download",
          name: "download",
          component: () => import("@/pages/Download.vue"),
        },
        {
          path: "daily",
          name: "daily",
          component: () => import("@/pages/Daily.vue"),
        },
        {
          path: "radio",
          name: "radio",
          component: () => import("@/pages/Radio.vue"),
        },
        {
          path: "radio/:id",
          name: "radio-detail",
          component: () => import("@/pages/RadioDetail.vue"),
        },
        {
          path: "mv",
          name: "mv",
          component: () => import("@/pages/MvBrowse.vue"),
        },
        {
          path: "mv/:id",
          name: "mv-detail",
          component: () => import("@/pages/MvDetail.vue"),
        },
        {
          path: "video/:id",
          name: "Video",
          component: () => import("@/pages/Video.vue"),
          props: true,
        },
        {
          path: "events",
          name: "events",
          component: () => import("@/pages/Events.vue"),
        },
        {
          path: "event/:id",
          name: "event-detail",
          component: () => import("@/pages/EventDetail.vue"),
        },
        {
          path: "automix",
          name: "automix",
          component: () => import("@/pages/Automix.vue"),
        },
        {
          path: "listen-together",
          name: "listen-together",
          component: () => import("@/pages/ListenTogether.vue"),
        },
        {
          path: "favorites",
          name: "favorites",
          component: () => import("@/pages/Favorites.vue"),
        },
        {
          path: "cloud",
          name: "cloud",
          component: () => import("@/pages/Cloud.vue"),
        },
        {
          path: "collection/:source/:type/:id",
          name: "collection",
          component: () => import("@/pages/Collection.vue"),
        },
        {
          path: "artist/:source/:id",
          name: "artist",
          component: () => import("@/pages/Artist.vue"),
        },
        {
          path: "artists/local",
          name: "artist-list",
          component: () => import("@/pages/LocalList.vue"),
        },
        {
          path: "albums/local",
          name: "album-list",
          component: () => import("@/pages/LocalList.vue"),
        },
        {
          path: "folders",
          name: "folders",
          component: () => import("@/pages/Folders.vue"),
        },
        {
          path: "search",
          name: "search",
          component: () => import("@/pages/Search.vue"),
        },
        {
          path: "streaming",
          component: () => import("@/pages/Streaming/Index.vue"),
          redirect: "/streaming/songs",
          children: [
            {
              path: "songs",
              name: "streaming-songs",
              component: () => import("@/pages/Streaming/Songs.vue"),
            },
            {
              path: "albums",
              name: "streaming-albums",
              component: () => import("@/pages/Streaming/Albums.vue"),
            },
            {
              path: "artists",
              name: "streaming-artists",
              component: () => import("@/pages/Streaming/Artists.vue"),
            },
            {
              path: "playlists",
              name: "streaming-playlists",
              component: () => import("@/pages/Streaming/Playlists.vue"),
            },
          ],
        },
      ],
    },
  ],
});

const PRELOAD_ROUTES = new Set([
  "library",
  "liked",
  "search",
  "daily",
]);

router.afterEach((to) => {
  if (to.name && PRELOAD_ROUTES.has(to.name as string)) {
    runIdle(() => {
      const siblings = router.getRoutes().filter(
        (r) => r.name && PRELOAD_ROUTES.has(r.name as string) && r.name !== to.name,
      );
      for (const route of siblings) {
        runIdle(() => {
          try {
            router.resolve(route);
          } catch {
            // 预加载失败静默
          }
        });
      }
    });
  }
});

export default router;