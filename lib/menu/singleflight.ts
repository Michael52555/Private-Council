type SingleFlightGlobal = typeof globalThis & {
  restaurantSingleFlights?: Map<string, Promise<unknown>>;
};

function activeFlights(): Map<string, Promise<unknown>> {
  const singleFlightGlobal = globalThis as SingleFlightGlobal;
  singleFlightGlobal.restaurantSingleFlights ??= new Map();
  return singleFlightGlobal.restaurantSingleFlights;
}

export function runSingleFlight<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const flights = activeFlights();
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const flight = task().finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
}
