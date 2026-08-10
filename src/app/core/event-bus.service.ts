import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

interface BusEvent<T = unknown> {
  name: string;
  data: T;
}

/** Thin pub/sub bus, ported 1:1 from legacy/src/bus.js so event names carry over unchanged. */
@Injectable({ providedIn: 'root' })
export class EventBusService {
  private readonly subject = new Subject<BusEvent>();

  emit<T>(eventName: string, data?: T): void {
    this.subject.next({ name: eventName, data });
  }

  on<T>(eventName: string) {
    return this.subject.asObservable().pipe(
      filter((event) => event.name === eventName),
      map((event) => event.data as T)
    );
  }
}
