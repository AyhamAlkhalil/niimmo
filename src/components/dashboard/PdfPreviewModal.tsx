import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef } from "react";
import { Loader2, ChevronLeft, ChevronRight, Download, X, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ladePdfjs } from "@/utils/pdfjs";

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  dokument: {
    id: string;
    titel: string;
    pfad: string;
    dateityp: string;
  } | null;
}

export const PdfPreviewModal = ({ isOpen, onClose, dokument }: PdfPreviewModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [isImage, setIsImage] = useState(false);
  const [isHtml, setIsHtml] = useState(false);

  const checkIfImage = (dateityp?: string, pfad?: string, titel?: string): boolean => {
    const clean = (s?: string) => s?.toLowerCase().trim() || '';
    const normalized = clean(dateityp).replace(/^\./, '');
    if (normalized.startsWith('image/')) return true;
    const pathTitle = `${clean(pfad)} ${clean(titel)}`;
    if (/(\.(jpe?g|png))(\s|$)/i.test(pathTitle)) return true;
    const ext = pathTitle.match(/\.([a-z0-9]+)(\s|$)/i)?.[1];
    const candidate = normalized || ext;
    if (!candidate) return false;
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'jpeg', 'jpg', 'png'];
    return imageTypes.includes(candidate);
  };

  const checkIfHtml = (dateityp?: string, pfad?: string): boolean => {
    return dateityp?.includes('html') || pfad?.endsWith('.html') || false;
  };

  useEffect(() => {
    if (isOpen && dokument) {
      const isImg = checkIfImage(dokument.dateityp, dokument.pfad, dokument.titel);
      const isHtmlDoc = checkIfHtml(dokument.dateityp, dokument.pfad);
      setIsImage(isImg);
      setIsHtml(isHtmlDoc);
      
      if (isImg) {
        loadImage();
      } else if (isHtmlDoc) {
        loadHtml();
      } else {
        loadPdf();
      }
    } else {
      // Cleanup when closing
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setPdfDoc(null);
      setCurrentPage(1);
      setTotalPages(0);
      setIsImage(false);
      setIsHtml(false);
    }
  }, [isOpen, dokument]);

  useEffect(() => {
    if (pdfDoc && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage]);

  const loadImage = async () => {
    if (!dokument) return;

    setLoading(true);
    try {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('dokumente')
        .createSignedUrl(dokument.pfad, 3600);

      if (signedUrlError) throw signedUrlError;

      setPdfUrl(signedUrlData.signedUrl);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Bild konnte nicht geladen werden.",
        variant: "destructive",
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const loadHtml = async () => {
    if (!dokument) return;

    setLoading(true);
    try {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('dokumente')
        .createSignedUrl(dokument.pfad, 3600);

      if (signedUrlError) throw signedUrlError;

      setPdfUrl(signedUrlData.signedUrl);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Dokument konnte nicht geladen werden.",
        variant: "destructive",
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const loadPdf = async () => {
    if (!dokument) return;

    setLoading(true);
    try {
      // Get signed URL for the PDF
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('dokumente')
        .createSignedUrl(dokument.pfad, 3600); // Valid for 1 hour

      if (signedUrlError) throw signedUrlError;

      // Fetch the PDF blob
      const response = await fetch(signedUrlData.signedUrl);
      if (!response.ok) throw new Error('Failed to fetch PDF');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      // PDF.js samt mitgebautem Worker laden (siehe utils/pdfjs.ts)
      const pdfjsLib = await ladePdfjs();

      const arrayBuffer = await blob.arrayBuffer();
      
      // Safari-compatible PDF loading with additional options
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        // Disable font rendering issues in Safari
        disableFontFace: false,
        // Enable standard fonts for better compatibility
        useSystemFonts: false,
        // Disable range requests which can cause issues
        disableRange: true,
        // Disable streaming for better compatibility
        disableStream: true,
      });
      
      const pdf = await loadingTask.promise;
      
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "PDF konnte nicht geladen werden.",
        variant: "destructive",
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const renderPage = async (pageNumber: number) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { 
        // Safari-specific optimizations
        willReadFrequently: false,
        alpha: false 
      });
      
      if (!context) return;

      // Calculate scale to fit container (max 800px width)
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(800 / viewport.width, 1.5);
      const scaledViewport = page.getViewport({ scale });

      // Set canvas size
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      // Clear canvas before rendering (important for Safari)
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Render with Safari-compatible options
      const renderTask = page.render({
        canvasContext: context,
        viewport: scaledViewport,
        // Improve rendering quality
        intent: 'display',
      });

      await renderTask.promise;
    } catch (error) {
      toast({
        title: "Rendering-Fehler",
        description: "Seite konnte nicht dargestellt werden.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async () => {
    if (!dokument || !pdfUrl) return;

    setDownloading(true);
    try {
      const response = await fetch(pdfUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = isHtml ? '.html' : (isImage ? '.jpg' : '.pdf');
      a.download = dokument.titel || `dokument${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download erfolgreich",
        description: `${dokument.titel} wurde heruntergeladen.`,
      });
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Download fehlgeschlagen.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!pdfUrl || !isHtml) return;
    
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate">{dokument?.titel || 'PDF Vorschau'}</span>
            <div className="flex items-center gap-2">
              {isHtml && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  disabled={loading}
                >
                  <Printer className="h-4 w-4" />
                  <span className="ml-2">Drucken</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={downloading || loading}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-2">Download</span>
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-gray-100 rounded-lg p-4 flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">
                {isImage ? 'Bild' : isHtml ? 'Dokument' : 'PDF'} wird geladen...
              </p>
            </div>
          ) : isImage && pdfUrl ? (
            <img 
              src={pdfUrl} 
              alt={dokument?.titel || 'Bild Vorschau'} 
              className="max-w-full max-h-full object-contain shadow-lg rounded"
            />
          ) : isHtml && pdfUrl ? (
            <iframe 
              src={pdfUrl} 
              title={dokument?.titel || 'Dokument Vorschau'}
              className="w-full h-full min-h-[600px] bg-white shadow-lg rounded"
            />
          ) : (
            <canvas ref={canvasRef} className="max-w-full shadow-lg" />
          )}
        </div>

        {/* Page Navigation - nur für PDFs */}
        {!isImage && totalPages > 0 && (
          <div className="flex items-center justify-between border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPreviousPage}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Zurück
            </Button>

            <span className="text-sm text-muted-foreground">
              Seite {currentPage} von {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={goToNextPage}
              disabled={currentPage === totalPages}
            >
              Weiter
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};