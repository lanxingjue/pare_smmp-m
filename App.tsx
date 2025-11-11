import React, { useState, useCallback } from 'react';
import { parsePcapFile, parseMultipleSmppPdus } from './services/parser';
import type { ParsedSmppData, PacketSummary } from './types';
import { UploadIcon, FileIcon, AlertTriangleIcon, CodeIcon } from './components/icons';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [packets, setPackets] = useState<PacketSummary[]>([]);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [detailedPacketData, setDetailedPacketData] = useState<ParsedSmppData[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      setPackets([]);
      setSelectedPacketIndex(null);
      setDetailedPacketData(null);
      setError(null);
    }
  };

  const handleParse = useCallback(async () => {
    if (!file) {
      setError('Please select a PCAP file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setPackets([]);
    setSelectedPacketIndex(null);
    setDetailedPacketData(null);


    try {
      const packetSummaries = await parsePcapFile(file);
      if (packetSummaries.length === 0) {
          setError('No valid TCP packets with payloads found in the PCAP file.');
      }
      setPackets(packetSummaries);
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('An unknown error occurred during parsing.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [file]);
  
  const handleSelectPacket = useCallback((index: number) => {
    setSelectedPacketIndex(index);
    setError(null); // Clear global errors
    setDetailedPacketData(null);
    try {
        const selectedPacket = packets.find(p => p.index === index);
        if (selectedPacket) {
            const dataArray = parseMultipleSmppPdus(selectedPacket.payload);
            setDetailedPacketData(dataArray);
        }
    } catch (e) {
        if (e instanceof Error) {
            setError(`Failed to parse packet #${index}: ${e.message}`);
        } else {
            setError(`An unknown error occurred while parsing packet #${index}.`);
        }
    }
  }, [packets]);

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => event.preventDefault();
  
  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      setPackets([]);
      setSelectedPacketIndex(null);
      setDetailedPacketData(null);
      setError(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <CodeIcon className="w-10 h-10 text-teal-400" />
            PCAP SMPP-M Inspector
          </h1>
          <p className="text-lg text-gray-400">
            Upload a PCAP file to inspect SMPP packets.
          </p>
        </header>

        <main className="bg-gray-800 rounded-xl shadow-2xl p-6 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
               <label 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  htmlFor="file-upload" 
                  className="relative block w-full rounded-lg border-2 border-dashed border-gray-600 hover:border-teal-400 p-8 text-center cursor-pointer transition-colors duration-200 ease-in-out"
                >
                <UploadIcon className="mx-auto h-10 w-10 text-gray-500" />
                <span className="mt-2 block text-sm font-semibold text-gray-300">
                  {file ? `Selected: ${file.name}` : "Drop PCAP here, or click"}
                </span>
                <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pcap,.cap" />
              </label>
              <button
                onClick={handleParse}
                disabled={!file || isLoading}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-teal-500 hover:bg-teal-600 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-teal-500 transition-all duration-200"
              >
                {isLoading ? 'Parsing...' : 'Analyze Packets'}
              </button>
            </div>
            <div className="md:col-span-2">
              <PacketList 
                packets={packets}
                selectedIndex={selectedPacketIndex}
                onSelect={handleSelectPacket}
              />
            </div>
          </div>
          
          {error && <ErrorDisplay message={error} />}
          {detailedPacketData && detailedPacketData.length > 0 && <ResultsDisplay data={detailedPacketData} />}
          
        </main>
         <footer className="text-center mt-8 text-gray-500 text-sm">
            <p>Built with React, TypeScript, and Tailwind CSS. Based on YDN XXX-YYY specification.</p>
        </footer>
      </div>
    </div>
  );
};

const PacketList: React.FC<{packets: PacketSummary[], selectedIndex: number | null, onSelect: (index: number) => void}> = ({ packets, selectedIndex, onSelect }) => {
    if (packets.length === 0) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-900/50 rounded-lg text-gray-500">
                <p>Packet list will appear here after analysis.</p>
            </div>
        );
    }

    return (
        <div className="h-64 overflow-y-auto bg-gray-900/50 rounded-lg shadow-inner">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-gray-700/50 sticky top-0">
                    <tr>
                        <th scope="col" className="px-4 py-2">No.</th>
                        <th scope="col" className="px-4 py-2">Source</th>
                        <th scope="col" className="px-4 py-2">Destination</th>
                        <th scope="col" className="px-4 py-2">Length</th>
                        <th scope="col" className="px-4 py-2">Info</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {packets.map(packet => (
                        <tr 
                            key={packet.index} 
                            onClick={() => onSelect(packet.index)}
                            className={`cursor-pointer hover:bg-teal-500/20 ${selectedIndex === packet.index ? 'bg-teal-500/30' : ''}`}
                        >
                            <td className="px-4 py-2 font-medium">{packet.index}</td>
                            <td className="px-4 py-2 font-mono">{packet.sourceIp}:{packet.sourcePort}</td>
                            <td className="px-4 py-2 font-mono">{packet.destIp}:{packet.destPort}</td>
                            <td className="px-4 py-2">{packet.length}</td>
                            <td className="px-4 py-2 font-semibold text-teal-300">{packet.info}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ErrorDisplay: React.FC<{ message: string }> = ({ message }) => (
    <div className="mt-6 bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg relative" role="alert">
      <div className="flex items-center">
        <AlertTriangleIcon className="w-5 h-5 mr-3" />
        <div>
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{message}</span>
        </div>
      </div>
    </div>
);

const ResultsDisplay: React.FC<{ data: ParsedSmppData[] }> = ({ data }) => {
    const renderValue = (value: any) => {
        if (typeof value === 'object' && value !== null) {
            return (
                <ul className="pl-4 mt-1 border-l border-gray-600">
                    {Object.entries(value).map(([key, val]) => (
                        <li key={key} className="text-sm">
                            <span className="font-semibold text-teal-400">{key}:</span> {renderValue(val)}
                        </li>
                    ))}
                </ul>
            );
        }
        return <span className="text-gray-300 font-mono">{String(value)}</span>;
    };

    return (
        <div className="mt-6 bg-gray-900/50 rounded-lg p-6 shadow-inner">
            <h2 className="text-2xl font-bold text-white mb-4 border-b border-gray-700 pb-2">Packet Details ({data.length} PDU{data.length > 1 ? 's' : ''})</h2>
            <div className="space-y-6">
                {data.map((pdu, index) => (
                    <div key={index} className="border-b border-gray-700 last:border-b-0 pb-4 last:pb-0">
                         <h3 className="text-lg font-bold text-white mb-3">
                            PDU #{index + 1}: <span className="text-teal-400">{pdu.header.command_name}</span>
                        </h3>
                        {Object.entries(pdu).map(([section, fields]) => (
                            <div key={section}>
                                <h4 className="text-md font-semibold text-teal-400 capitalize mb-2">{section.replace(/_/g, ' ')}</h4>
                                <ul className="space-y-1 pl-2">
                                    {Object.entries(fields).map(([key, value]) => (
                                        <li key={key} className="flex flex-col sm:flex-row sm:items-start text-sm">
                                            <span className="font-medium text-gray-400 w-48 shrink-0">{key}:</span>
                                            {renderValue(value)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default App;