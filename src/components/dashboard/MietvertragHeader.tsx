
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText } from "lucide-react";

interface MietvertragHeaderProps {
  onBack: () => void;
  status?: string;
}

export const MietvertragHeader = ({ onBack, status }: MietvertragHeaderProps) => {
  const getStatusColor = () => {
    switch (status) {
      case 'aktiv':
        return 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-200';
      case 'gekuendigt':
        return 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-lg shadow-yellow-200';
      default:
        return 'bg-gradient-to-r from-gray-500 to-gray-600 text-white shadow-lg shadow-gray-200';
    }
  };

  return (
    <div className="elegant-card p-6 rounded-2xl mb-8 border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button 
            variant="ghost" 
            onClick={onBack}
            className="modern-button-ghost hover:bg-red-50 hover:text-red-600 transition-all duration-200"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Übersicht
          </Button>
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gradient-red">Mietvertrag Details</h1>
              <p className="text-gray-600">Vollständige Vertragsübersicht</p>
            </div>
          </div>
        </div>
        {status && (
          <Badge className={`px-4 py-2 text-sm font-semibold rounded-full ${getStatusColor()}`}>
            {status === 'aktiv' ? '● Aktiv' : status === 'gekuendigt' ? '⚠ Gekündigt' : status}
          </Badge>
        )}
      </div>
    </div>
  );
};
