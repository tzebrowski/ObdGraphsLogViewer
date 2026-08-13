import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { AccountService } from '../core/account.service';
import { AuthService } from '../core/auth.service';
import { DriveService } from '../core/drive.service';

/**
 * The app's account sign-in screen -- Google-only, ported from tuning-tools/webapp's
 * AccountModal (hextune's identically-purposed dialog). Unlike hextune (separate
 * GoogleAuthService/AccountService, one Google consent screen for Drive, a later separate one
 * for the account), this app already unifies both into a single consent screen (see
 * AuthService's SCOPES) — DriveService.ensureSignedIn() covers sign-in + account-link without
 * also triggering a Drive folder scan.
 */
@Component({
  selector: 'app-account-modal',
  imports: [],
  templateUrl: './account-modal.html',
  styleUrl: './account-modal.css',
})
export class AccountModal {
  protected readonly account = inject(AccountService);
  private readonly auth = inject(AuthService);
  private readonly drive = inject(DriveService);

  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly submitting = signal(false);
  protected readonly error = signal('');

  constructor() {
    // Fresh state every time the dialog opens -- it has no unmount/remount between opens.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.error.set('');
        this.submitting.set(false);
      });
    });
  }

  protected cancel(): void {
    this.closed.emit();
  }

  protected async continueWithGoogle(): Promise<void> {
    this.submitting.set(true);
    this.error.set('');

    const entitled = await this.drive.ensureSignedIn();

    this.submitting.set(false);
    if (entitled) {
      this.closed.emit();
      return;
    }
    if (!this.auth.isLoggedIn()) {
      this.error.set('Google sign-in was cancelled or unavailable.');
      return;
    }
    // Signed in but not entitled -- AppStateService.showAlert already surfaced why.
    this.closed.emit();
  }
}
