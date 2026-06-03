import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter } from "lucide-react";

interface FilterPanelProps {
  filters: {
    mietstatus: string;
    zahlungsstatus: string;
    vertragsart: string;
  };
  onFilterChange: (key: string, value: string) => void;
  activeFiltersCount: number;
}

export const FilterPanel = ({ filters, onFilterChange, activeFiltersCount }: FilterPanelProps) => {
  return (
    <Card className="mb-6 elegant-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 font-sans">
          <Filter className="h-5 w-5" />
          Filter
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="ml-2 font-sans">
              {activeFiltersCount} aktiv
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-sm font-sans font-medium mb-2 block text-gray-700">Mietstatus</label>
            <Select value={filters.mietstatus} onValueChange={(value) => onFilterChange('mietstatus', value)}>
              <SelectTrigger className="w-full modern-input font-sans cursor-pointer hover:bg-gray-50 transition-colors">
                <SelectValue placeholder="Alle Status" />
              </SelectTrigger>
              <SelectContent className="bg-white border modern-shadow-lg z-50">
                <SelectItem value="all" className="font-sans cursor-pointer">Alle Status</SelectItem>
                <SelectItem value="aktiv" className="font-sans cursor-pointer">Aktiv</SelectItem>
                <SelectItem value="gekuendigt" className="font-sans cursor-pointer">Gekündigt</SelectItem>
                <SelectItem value="leerstehend" className="font-sans cursor-pointer">Leerstehend</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-sans font-medium mb-2 block text-gray-700">Zahlungsstatus</label>
            <Select value={filters.zahlungsstatus} onValueChange={(value) => onFilterChange('zahlungsstatus', value)}>
              <SelectTrigger className="w-full modern-input font-sans cursor-pointer hover:bg-gray-50 transition-colors">
                <SelectValue placeholder="Alle Zahlungen" />
              </SelectTrigger>
              <SelectContent className="bg-white border modern-shadow-lg z-50">
                <SelectItem value="all" className="font-sans cursor-pointer">Alle Zahlungen</SelectItem>
                <SelectItem value="bezahlt" className="font-sans cursor-pointer">Bezahlt</SelectItem>
                <SelectItem value="offen" className="font-sans cursor-pointer">Offen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-sans font-medium mb-2 block text-gray-700">Vertragsart</label>
            <Select value={filters.vertragsart} onValueChange={(value) => onFilterChange('vertragsart', value)}>
              <SelectTrigger className="w-full modern-input font-sans cursor-pointer hover:bg-gray-50 transition-colors">
                <SelectValue placeholder="Alle Vertragsarten" />
              </SelectTrigger>
              <SelectContent className="bg-white border modern-shadow-lg z-50">
                <SelectItem value="all" className="font-sans cursor-pointer">Alle Vertragsarten</SelectItem>
                <SelectItem value="privat" className="font-sans cursor-pointer">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                    Privat
                  </span>
                </SelectItem>
                <SelectItem value="gewerbe" className="font-sans cursor-pointer">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                    Gewerbe
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
