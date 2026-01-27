export interface PersonWithName {
  person_id: string;
  name: string;
  [key: string]: unknown;
}

export interface HasPersonIdAndName {
  person_id: string;
  name: string;
}

export interface PersonWithDisplayName extends PersonWithName {
  displayName: string;
}

export function generateDisplayNames<T extends HasPersonIdAndName>(
  persons: T[],
): (T & { displayName: string })[] {
  const nameOccurrences = new Map<string, number>();
  persons.forEach((person) => {
    const normalizedName = person.name.toLowerCase();
    const count = nameOccurrences.get(normalizedName) || 0;
    nameOccurrences.set(normalizedName, count + 1);
  });

  const nameCounters = new Map<string, number>();

  return persons.map((person) => {
    const normalizedName = person.name.toLowerCase();
    const occurrences = nameOccurrences.get(normalizedName) || 1;

    if (occurrences === 1) {
      return {
        ...person,
        displayName: person.name,
      };
    }

    const currentCount = nameCounters.get(normalizedName) || 0;
    nameCounters.set(normalizedName, currentCount + 1);

    const displayName =
      currentCount === 0 ? person.name : `${person.name} (${currentCount + 1})`;

    return {
      ...person,
      displayName,
    };
  });
}

export function getDisplayName<T extends HasPersonIdAndName>(
  personId: string,
  persons: T[],
): string {
  const withDisplayNames = generateDisplayNames(persons);
  const person = withDisplayNames.find((p) => p.person_id === personId);
  return person?.displayName || "Unknown";
}

export function createDisplayNameMap<T extends HasPersonIdAndName>(
  persons: T[],
): Map<string, string> {
  const withDisplayNames = generateDisplayNames(persons);
  return new Map(withDisplayNames.map((p) => [p.person_id, p.displayName]));
}
