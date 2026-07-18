import { Mixpanel } from 'mixpanel-react-native';

export const mixpanel = new Mixpanel('token', true);

export function trackQuizCompleted(score: number): void {
  mixpanel.track('quiz_completed', { score });
}
