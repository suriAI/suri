import type { FaceRecognitionResponse } from "../../../types/recognition";
import { TRACKING_HISTORY_LIMIT } from "../constants";

export interface ExtendedFaceRecognitionResponse
  extends FaceRecognitionResponse {
  memberName?: string;
}

export const trimTrackingHistory = <T>(history: T[]): T[] => {
  if (history.length <= TRACKING_HISTORY_LIMIT) {
    return history;
  }
  return history.slice(history.length - TRACKING_HISTORY_LIMIT);
};

export const isRecognitionResponseEqual = (
  a: ExtendedFaceRecognitionResponse | undefined,
  b: ExtendedFaceRecognitionResponse | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.success === b.success &&
    a.person_id === b.person_id &&
    a.name === b.name &&
    a.similarity === b.similarity &&
    a.error === b.error &&
    a.memberName === b.memberName
  );
};

export const areRecognitionMapsEqual = (
  prev: Map<number, ExtendedFaceRecognitionResponse>,
  next: Map<number, ExtendedFaceRecognitionResponse>,
): boolean => {
  if (prev === next) return true;
  if (prev.size !== next.size) return false;

  for (const [key, nextValue] of next) {
    const prevValue = prev.get(key);
    if (!isRecognitionResponseEqual(prevValue, nextValue)) {
      return false;
    }
  }

  return true;
};
