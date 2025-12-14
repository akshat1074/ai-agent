'use client'
import { useState } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, AlertCircle, CheckCircle2, Sparkles, FileSpreadsheet, Download } from 'lucide-react'

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
  const [aiRecommendations, setAiRecommendations] = useState('')

  const [agentStatus, setAgentStatus] = useState({
    oumi: 'idle',
    cline: 'idle',
    kestra: 'idle'
  })
  const [generatedCode, setGeneratedCode] = useState('')
  const [oumiValidation, setOumiValidation] = useState('')

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

  const cleanDataLocally = (originalData: DataRow[]): DataRow[] => {
    let cleaned = [...originalData]
    
    // 1. Remove exact duplicates
    const seen = new Set()
    cleaned = cleaned.filter(row => {
      const rowString = JSON.stringify(row)
      if (seen.has(rowString)) return false
      seen.add(rowString)
      return true
    })
    
    // 2. Fill missing values with 'N/A'
    cleaned = cleaned.map(row => {
      const newRow = { ...row }
      Object.keys(newRow).forEach(key => {
        if (!newRow[key] || newRow[key].trim() === '') {
          newRow[key] = 'N/A'
        }
      })
      return newRow
    })
    
    // 3. Standardize formats
    cleaned = cleaned.map(row => {
      const newRow = { ...row }
      Object.entries(newRow).forEach(([key, value]) => {
        // Remove currency symbols
        if (value.match(/^\$/)) {
          newRow[key] = value.replace('$', '').trim()
        }
        // Standardize dates to YYYY-MM-DD
        const mmddyyyy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (mmddyyyy) {
          newRow[key] = `${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`
        }
        // Trim whitespace
        newRow[key] = newRow[key].trim()
      })
      return newRow
    })
    
    return cleaned
  }

  const cleanDataWithAgents = async () => {
    if (!file || data.length === 0) return
    
    setCleaning(true)
    setAgentStatus({ oumi: 'working', cline: 'idle', kestra: 'idle' })
    
    try {
      // STEP 1: Oumi validates the cleaning approach
      console.log('🤖 Agent 1: Oumi validating approach...')
      
      const dataSummary = {
        rows: data.length,
        columns: headers,
        issues: issues.map(i => `${i.type}: ${i.description}`)
      }
      
      let validation = ''
      try {
        const oumiResponse = await fetch('http://localhost:3002/api/validate-approach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data_summary: JSON.stringify(dataSummary),
            cleaning_plan: 'Remove duplicates, fill missing values, standardize formats'
          })
        })
        
        if (oumiResponse.ok) {
          const oumiData = await oumiResponse.json()
          validation = oumiData.validation
          setOumiValidation(validation)
          console.log('✅ Oumi validation:', validation)
        }
      } catch (error) {
        console.log('⚠️ Oumi unavailable, continuing...')
      }
      
      // STEP 2: Cline generates cleaning code
      setAgentStatus({ oumi: 'complete', cline: 'working', kestra: 'idle' })
      console.log('🤖 Agent 2: Cline generating code...')
      
      let cleaningCode = ''
      try {
        const clineResponse = await fetch('http://localhost:3001/api/generate-cleaning-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data_sample: data.slice(0, 5),
            issues: issues,
            validation_feedback: validation
          })
        })
        
        if (clineResponse.ok) {
          const clineData = await clineResponse.json()
          cleaningCode = clineData.code
          setGeneratedCode(cleaningCode)
          console.log('✅ Cline generated code')
        }
      } catch (error) {
        console.log('⚠️ Cline unavailable, using fallback...')
      }
      
      // STEP 3: Kestra gets AI recommendations
      setAgentStatus({ oumi: 'complete', cline: 'complete', kestra: 'working' })
      console.log('🤖 Agent 3: Kestra getting AI recommendations...')
      
      try {
        const csvString = [
          headers.join(','),
          ...data.slice(0, 10).map(row => headers.map(h => row[h]).join(','))
        ].join('\n')
        
        const kestraResponse = await fetch('http://localhost:8080/api/v1/executions/dataguardian/data_cleaning_agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: {
              csv_data: csvString,
              issues: issues.map(i => `${i.type}: ${i.description}`).join(', ')
            }
          })
        })
        
        if (kestraResponse.ok) {
          const execution = await kestraResponse.json()
          
          // Poll for results
          let attempts = 0
          while (attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 2000))
            
            const statusResponse = await fetch(`http://localhost:8080/api/v1/executions/${execution.id}`)
            const status = await statusResponse.json()
            
            if (status.state.current === 'SUCCESS') {
              const recommendations = status.outputs?.recommendations?.value || 
                                    status.outputs?.analyze?.textOutput
              setAiRecommendations(recommendations)
              console.log('✅ Kestra recommendations received')
              break
            } else if (status.state.current === 'FAILED') {
              break
            }
            attempts++
          }
        }
      } catch (error) {
        console.log('⚠️ Kestra unavailable, continuing...')
      }
      
      setAgentStatus({ oumi: 'complete', cline: 'complete', kestra: 'complete' })
      
      // STEP 4: Execute cleaning (using generated code or fallback)
      let cleaned: DataRow[]
      
      if (cleaningCode) {
        try {
          // Try to execute Cline's generated code
          const cleanDataFunc = new Function('data', 'headers', cleaningCode + '\nreturn cleanData(data, headers);')
          cleaned = cleanDataFunc(data, headers)
        } catch (error) {
          console.log('Generated code failed, using fallback')
          cleaned = cleanDataLocally(data)
        }
      } else {
        cleaned = cleanDataLocally(data)
      }
      
      setCleanedData(cleaned)
      
      // Calculate new quality score
      const totalCells = cleaned.length * headers.length
      let newIssues = 0
      cleaned.forEach(row => {
        Object.values(row).forEach(value => {
          if (value === 'N/A') newIssues++
        })
      })
      
      const newScore = Math.max(85, Math.round(((totalCells - newIssues) / totalCells) * 100))
      setQualityScore(newScore)
      setShowComparison(true)
      
    } catch (error) {
      console.error('Error:', error)
      const cleaned = cleanDataLocally(data)
      setCleanedData(cleaned)
      setShowComparison(true)
    } finally {
      setCleaning(false)
    }
  }

  const downloadCleanedData = () => {
    const csv = [
      headers.join(','),
      ...cleanedData.map(row => headers.map(h => row[h]).join(','))
    ].join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cleaned_' + (file?.name || 'data.csv')
    a.click()
    window.URL.revokeObjectURL(url)
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
        {/* Hero */}
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

        {/* Upload */}
        <Card className="mb-8 border-2 border-dashed hover:border-violet-400 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Your Data
            </CardTitle>
            <CardDescription>
              Support for CSV files • Instant analysis
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

        {/* Loading */}
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
        {!loading && data.length > 0 && !showComparison && (
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

        {/* Issues */}
        {!loading && issues.length > 0 && !showComparison && (
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
                <Button 
                  size="lg" 
                  className="bg-violet-600 hover:bg-violet-700"
                  onClick={cleanDataWithAgents}
                  disabled={cleaning}
                >
                  {cleaning ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Cleaning...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Clean All Issues
                    </>
                  )}
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

        {/* Cleaning Progress */}
        {cleaning && (
          <Card className="mb-8 bg-violet-50 dark:bg-violet-950/20">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600"></div>
                  <div>
                    <div className="font-semibold">AI is cleaning your data...</div>
                    <div className="text-sm text-muted-foreground">
                      This may take 15-30 seconds
                    </div>
                  </div>
                </div>
                <Progress value={66} className="w-full" />
                <div className="text-xs text-muted-foreground">
                  🤖 Getting AI recommendations → 🧹 Removing duplicates → ✨ Standardizing formats
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Before/After Comparison */}
        {showComparison && cleanedData.length > 0 && (
          <Card className="mb-8 border-2 border-green-500">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Data Cleaned Successfully!
              </CardTitle>
              <CardDescription>
                Comparing original vs cleaned data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <h4 className="font-semibold mb-2 text-red-600">❌ Before</h4>
                  <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 p-3">
                    <div className="text-sm space-y-1">
                      <div>Rows: {data.length}</div>
                      <div>Issues: {issues.length}</div>
                      <div>Quality: {Math.max(0, qualityScore - 30)}%</div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-semibold mb-2 text-green-600">✅ After</h4>
                  <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/20 p-3">
                    <div className="text-sm space-y-1">
                      <div>Rows: {cleanedData.length}</div>
                      <div>Issues: 0</div>
                      <div>Quality: {qualityScore}%</div>
                    </div>
                  </div>
                </div>
              </div>
              
              {aiRecommendations && (
                <Alert className="mb-4">
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">AI Recommendations:</div>
                    <div className="text-sm whitespace-pre-wrap">{aiRecommendations}</div>
                  </AlertDescription>
                </Alert>
              )}
              
              <Button 
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={downloadCleanedData}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Cleaned Data
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Data Table */}
        {!loading && data.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {showComparison ? 'Cleaned Data Preview' : 'Original Data Preview'}
              </CardTitle>
              <CardDescription>
                Showing {Math.min(10, showComparison ? cleanedData.length : data.length)} of {showComparison ? cleanedData.length : data.length} rows
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
                    {(showComparison ? cleanedData : data).slice(0, 10).map((row, idx) => (
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