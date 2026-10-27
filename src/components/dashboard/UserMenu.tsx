
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { User, LogOut, Settings } from 'lucide-react';

export const UserMenu = () => {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setIsOpen(false);
  };

  if (!user) return null;

  const initiale = (user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-10 gap-2.5 px-1.5 2xl:pr-3" aria-label={`Benutzer-Menü: ${user.email}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground" aria-hidden="true">
            {initiale}
          </span>
          <span className="hidden max-w-[14rem] truncate text-sm text-foreground/80 2xl:block">{user.email}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Benutzer-Menü
          </DialogTitle>
          <DialogDescription>
            Angemeldet als: {user.email}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-4">
          <div className="border-b border-border pb-3">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">E-Mail</div>
            <div className="mt-1 font-medium">{user.email}</div>
          </div>
          <div className="border-b border-border pb-3">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Benutzer-ID</div>
            <div className="mt-1 break-all font-mono text-xs text-foreground/80">{user.id}</div>
          </div>
          <Button 
            onClick={handleSignOut}
            variant="destructive"
            className="w-full flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
