'use client'
import { useState } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, AlertCircle, CheckCircle2, Sparkles, FileSpreadsheet } from 'lucide-react'

interface DataRow {
  [key: string]: string
}

interface Issue {
  type: string
  description: string
  count: number
  severity: 'high' | 'medium' | 'low'
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [data, setData] = useState<DataRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(false)
  const [qualityScore, setQualityScore] = useState(0)

  const [cleaning, setCleaning] = useState(false)
  const [cleanedData, setCleanedData] = useState<DataRow[]>([])
  const [showComparison, setShowComparison] = useState(false)

  const cleanData = async () => {
    if (!file || data.length === 0) return
    
    setCleaning(true)
    
    try {
      // Convert data back to CSV string
      const csvString = [
        headers.join(','),
        ...data.map(row => headers.map(h => row[h]).join(','))
      ].join('\n')
      
      // Call Kestra API
      const response = await fetch('http://localhost:8080/api/v1/executions/dataguardian/data_cleaning_agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: {
            csv_data: csvString,
            issues: issues.map(i => `${i.type}: ${i.description}`)
          }
        })
      })
      
      if (!response.ok) throw new Error('Kestra execution failed')
      
      const execution = await response.json()
      const executionId = execution.id
      
      // Poll for completion (simple version)
      let completed = false
      let attempts = 0
      
      while (!completed && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        const statusResponse = await fetch(`http://localhost:8080/api/v1/executions/${executionId}`)
        const status = await statusResponse.json()
        
        if (status.state.current === 'SUCCESS') {
          completed = true
          
          // Get the cleaned data from outputs
          const cleanedCsv = status.outputs?.cleaned_data?.value || status.outputs?.analyze_and_clean?.textOutput
          
          if (cleanedCsv) {
            // Parse cleaned CSV
            Papa.parse(cleanedCsv, {
              header: true,
              skipEmptyLines: true,
              complete: (results) => {
                setCleanedData(results.data as DataRow[])
                setShowComparison(true)
                
                // Recalculate quality score
                const cleanedHeaders = Object.keys((results.data as DataRow[])[0] || {})
                const totalCells = (results.data as DataRow[]).length * cleanedHeaders.length
                const newScore = Math.round((totalCells / (totalCells + 1)) * 100) // Simplified
                setQualityScore(newScore)
              }
            })
          }
        } else if (status.state.current === 'FAILED') {
          throw new Error('Cleaning failed')
        }
        
        attempts++
      }
      
      if (!completed) {
        throw new Error('Cleaning timeout')
      }
      
    } catch (error) {
      console.error('Error cleaning data:', error)
      alert('Failed to clean data. Check console for details.')
    } finally {
      setCleaning(false)
    }
  }

  const analyzeData = (parsedData: DataRow[]) => {
    const foundIssues: Issue[] = []
    let totalIssues = 0

    // Find duplicates
    const seen = new Set()
    let duplicates = 0
    parsedData.forEach(row => {
      const rowString = JSON.stringify(row)
      if (seen.has(rowString)) duplicates++
      seen.add(rowString)
    })
    if (duplicates > 0) {
      foundIssues.push({
        type: 'Duplicates',
        description: `${duplicates} duplicate rows detected`,
        count: duplicates,
        severity: 'high'
      })
      totalIssues += duplicates
    }

    // Find missing values
    let missingCount = 0
    parsedData.forEach(row => {
      Object.values(row).forEach(value => {
        if (!value || value.trim() === '') missingCount++
      })
    })
    if (missingCount > 0) {
      foundIssues.push({
        type: 'Missing Values',
        description: `${missingCount} empty cells found`,
        count: missingCount,
        severity: 'medium'
      })
      totalIssues += missingCount
    }

    // Check for format inconsistencies
    const columnFormats: { [key: string]: Set<string> } = {}
    parsedData.forEach(row => {
      Object.entries(row).forEach(([key, value]) => {
        if (!columnFormats[key]) columnFormats[key] = new Set()
        if (value.match(/^\d{4}-\d{2}-\d{2}$/)) columnFormats[key].add('YYYY-MM-DD')
        else if (value.match(/^\d{2}\/\d{2}\/\d{4}$/)) columnFormats[key].add('MM/DD/YYYY')
        else if (value.match(/^\$\d+/)) columnFormats[key].add('$')
      })
    })
    
    Object.entries(columnFormats).forEach(([col, formats]) => {
      if (formats.size > 1) {
        foundIssues.push({
          type: 'Format Inconsistency',
          description: `"${col}" has ${formats.size} different formats`,
          count: formats.size,
          severity: 'low'
        })
        totalIssues += formats.size
      }
    })

    // Calculate quality score
    const totalCells = parsedData.length * headers.length
    const score = Math.max(0, Math.round(((totalCells - totalIssues) / totalCells) * 100))
    setQualityScore(score)
    setIssues(foundIssues)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0]
    if (!uploadedFile) return

    setFile(uploadedFile)
    setLoading(true)

    Papa.parse(uploadedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData = results.data as DataRow[]
        setData(parsedData)
        const headerKeys = Object.keys(parsedData[0] || {})
        setHeaders(headerKeys)
        analyzeData(parsedData)
        setLoading(false)
      },
      error: (error) => {
        console.error('Error parsing CSV:', error)
        setLoading(false)
      }
    })
  }

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'high': return 'destructive'
      case 'medium': return 'default'
      case 'low': return 'secondary'
      default: return 'default'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500'
    if (score >= 50) return 'text-yellow-500'
    return 'text-red-500'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="w-8 h-8 text-violet-600" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              DataGuardian AI
            </h1>
          </div>
          <p className="text-xl text-muted-foreground">
            Clean and sort messy data in seconds with AI-powered automation
          </p>
        </div>

        {/* Upload Card */}
        <Card className="mb-8 border-2 border-dashed hover:border-violet-400 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Your Data
            </CardTitle>
            <CardDescription>
              Support for CSV files • Max 10MB • Instant analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button asChild variant="default" size="lg" className="bg-violet-600 hover:bg-violet-700">
                <label htmlFor="file-upload" className="cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Choose File
                  <input
                    id="file-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </Button>
              {file && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="font-medium">{file.name}</span>
                  <span>({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {loading && (
          <Card className="mb-8">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600"></div>
                  <span className="text-lg font-medium">Analyzing your data...</span>
                </div>
                <Progress value={66} className="w-full" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quality Score */}
        {!loading && data.length > 0 && (
          <Card className="mb-8 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 border-violet-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-2">Data Quality Score</h3>
                  <p className="text-muted-foreground">
                    {data.length} rows analyzed • {issues.length} issues found
                  </p>
                </div>
                <div className="text-center">
                  <div className={`text-6xl font-bold ${getScoreColor(qualityScore)}`}>
                    {qualityScore}
                  </div>
                  <div className="text-sm text-muted-foreground">out of 100</div>
                </div>
              </div>
              <Progress value={qualityScore} className="mt-4 h-3" />
            </CardContent>
          </Card>
        )}

        {/* Issues Found */}
        {!loading && issues.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600" />
                    Issues Detected
                  </CardTitle>
                  <CardDescription>
                    {issues.length} issue{issues.length !== 1 ? 's' : ''} need attention
                  </CardDescription>
                </div>
                <Button size="lg" className="bg-violet-600 hover:bg-violet-700">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Clean All Issues
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {issues.map((issue, idx) => (
                <Alert key={idx} variant="default">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between w-full">
                    <div>
                      <span className="font-semibold">{issue.type}:</span> {issue.description}
                    </div>
                    <Badge variant={getSeverityColor(issue.severity)}>
                      {issue.count}
                    </Badge>
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Data Table */}
        {!loading && data.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Data Preview</CardTitle>
              <CardDescription>
                Showing {Math.min(10, data.length)} of {data.length} rows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      {headers.map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.slice(0, 10).map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        {headers.map((header) => (
                          <TableCell key={header}>
                            {row[header] ? (
                              row[header]
                            ) : (
                              <span className="text-red-500 font-semibold">∅</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!loading && data.length === 0 && !file && (
          <Card className="border-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileSpreadsheet className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No data yet</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Upload a CSV file to get started. We'll analyze it instantly and show you what needs fixing.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}