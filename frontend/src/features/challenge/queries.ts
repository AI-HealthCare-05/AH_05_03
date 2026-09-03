/**
 * 챌린지 서버 상태. TanStack Query 로 다룬다 — 레포의 서버 상태 규약이고
 * (`shared/api/serviceMetadataClient.ts`), 수동 `useEffect` + `setState` 는
 * eslint `react-hooks/set-state-in-effect` 에 걸린다.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChallengeCheckResult, ChallengeSettings, ChallengeToday, HouseholdGarden } from "./contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";

const TODAY_KEY = ["challenge", "today"] as const;
const HOUSEHOLD_KEY = ["challenge", "household"] as const;
const SETTINGS_KEY = ["challenge", "settings"] as const;

export function useChallengeTodayQuery() {
  return useQuery({
    queryKey: TODAY_KEY,
    queryFn: () => serverApiClient.getChallengeToday<ChallengeToday>(),
    // 날짜가 바뀌면 서버가 다른 하루를 낸다. 화면을 켜 둔 채 자정을 넘기는 경우가
    // 있으므로 창을 다시 볼 때 한 번 확인한다.
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * 가정 정원. 가정이 없으면 `null` 이고 그것이 오류가 아니다 — 1인 가구에서도
 * 개인 모드로 화면이 성립해야 한다.
 */
export function useHouseholdGardenQuery() {
  return useQuery({
    queryKey: HOUSEHOLD_KEY,
    queryFn: async (): Promise<HouseholdGarden | null> => {
      const households = await serverApiClient.listHouseholds().catch(() => []);
      if (households.length === 0) return null;
      return serverApiClient
        .getHouseholdGarden<HouseholdGarden>(households[0].id)
        .catch(() => null);
    },
    retry: false,
  });
}

export function useToggleCheckMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ challengeId, checked }: { challengeId: string; checked: boolean }) =>
      checked
        ? serverApiClient.uncheckChallenge<ChallengeCheckResult>(challengeId)
        : serverApiClient.checkChallenge<ChallengeCheckResult>(challengeId),
    onSuccess: (result) => {
      // 응답에 갱신된 정원이 통째로 실려 오므로 **재조회를 걸지 않는다.** 체크 한 번에
      // 왕복 두 번을 하면 연타에서 화면이 튀고, 대시보드 카드까지 같은 키를 보므로
      // 재조회가 두 화면을 동시에 흔든다.
      //
      // 체크 표시는 서버에 다시 묻지 않고 여기서 뒤집는다. 방금 무엇을 눌렀는지
      // 알고 있고, 서버가 `checked` 로 결과를 확인해 준다.
      const previous = client.getQueryData<ChallengeToday>(TODAY_KEY);

      // 탭을 켜 둔 채 자정을 넘기면 화면은 어제를 보고 있는데 서버는 오늘로 기록한다.
      // 그대로 기우면 어제 목록에 오늘 체크가 얹혀 표시와 기록이 갈린다. 이때만 다시 받는다.
      //
      // 날짜 비교를 `setQueryData` 밖에서 하는 이유가 있다 — updater 가 `undefined` 를
      // 돌려주면 TanStack v5 는 캐시를 지우는 게 아니라 **갱신을 건너뛴다.** 안에서
      // 걸렀다가는 어제 목록이 그대로 남는다.
      if (previous && previous.today !== result.checked_on) {
        void client.invalidateQueries({ queryKey: TODAY_KEY });
      } else {
        client.setQueryData<ChallengeToday>(TODAY_KEY, (current) => {
          if (!current) return current;
          const daily = current.daily.map((item) =>
            item.id === result.challenge_id ? { ...item, checked: result.checked } : item,
          );
          const measures = current.measures.map((item) =>
            item.id === result.challenge_id ? { ...item, checked_this_week: result.checked } : item,
          );
          return {
            ...current,
            daily,
            measures,
            garden: result.garden,
            checked_count: daily.filter((item) => item.checked).length,
            watered_today: result.garden.watered_today,
          };
        });
      }

      // 가정 화면은 남의 점수도 바뀌었을 수 있어 서버에 다시 묻는다.
      void client.invalidateQueries({ queryKey: HOUSEHOLD_KEY });
    },
  });
}

export function useChallengeSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => serverApiClient.getChallengeSettings<ChallengeSettings>(),
    retry: false,
  });
}

export function useSaveSettingsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: Omit<ChallengeSettings, "configured">) =>
      serverApiClient.saveChallengeSettings<ChallengeSettings>({ ...settings }),
    onSuccess: (saved) => {
      client.setQueryData<ChallengeSettings>(SETTINGS_KEY, saved);
      // 목표가 바뀌면 주 완주 판정이 달라진다. 정원을 다시 받아야 한다.
      void client.invalidateQueries({ queryKey: TODAY_KEY });
      void client.invalidateQueries({ queryKey: HOUSEHOLD_KEY });
    },
  });
}
