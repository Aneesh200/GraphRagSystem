const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const glob = require('fast-glob');

const projectRoot = path.resolve(__dirname, '/Users/aneesh/grafana/packages/grafana-ui/src');

const fileExtensions = ['.js', '.jsx', '.ts', '.tsx'];

function isReactComponent(node) {
  return (
    (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') &&
    node.id &&
    /^[A-Z]/.test(node.id.name)
  );
}

function parseFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  const metadata = {
    id: relativePath,
    linesOfCode: code.split('\n').length,
    components: [],
    usesState: false,
    usesEffect: false,
    usesHooks: [],
    usesContext: false,
    declaresRoutes: false,
    stateVariables: [],
    imports: [],
    fileType: path.extname(filePath).replace('.', ''),
    nodeType: 'file',
  };

  traverse(ast, {
    ImportDeclaration({ node }) {
      const importPath = node.source.value;
      // Attempt to resolve both relative and aliased import paths.
      const importFile = resolveImportPath(filePath, importPath);
      if (importFile) {
        const importRelative = path.relative(projectRoot, importFile).replace(/\\/g, '/');
        metadata.imports.push(importRelative);
      }

      // Detect React Router route declarations (importing Route/Routes from react-router-dom)
      if (
        importPath === 'react-router-dom' &&
        node.specifiers &&
        node.specifiers.some(
          (s) =>
            s.type === 'ImportSpecifier' &&
            (s.imported.name === 'Route' || s.imported.name === 'Routes')
        )
      ) {
        metadata.declaresRoutes = true;
      }
    },
    FunctionDeclaration(path) {
      if (isReactComponent(path.node)) {
        metadata.components.push(path.node.id.name);
      }
    },
    VariableDeclarator(path) {
      if (
        path.node.init &&
        path.node.init.type === 'ArrowFunctionExpression' &&
        path.node.id.name &&
        /^[A-Z]/.test(path.node.id.name)
      ) {
        metadata.components.push(path.node.id.name);
      }

      if (
        path.node.init &&
        path.node.init.type === 'CallExpression' &&
        path.node.init.callee &&
        path.node.init.callee.name === 'useState' &&
        path.node.id &&
        path.node.id.type === 'ArrayPattern' &&
        path.node.id.elements.length > 0 &&
        path.node.id.elements[0] &&
        path.node.id.elements[0].type === 'Identifier'
      ) {
        const stateVarName = path.node.id.elements[0].name;
        metadata.stateVariables.push(stateVarName);
        if (!metadata.usesHooks.includes('useState')) {
          metadata.usesHooks.push('useState');
        }
        metadata.usesState = true;
      }
    },
    CallExpression(path) {
      const callee = path.node.callee.name;
      if (callee === 'useState') {
        metadata.usesState = true;
        metadata.usesHooks.push('useState');
      }
      if (callee === 'useEffect') {
        metadata.usesEffect = true;
        metadata.usesHooks.push('useEffect');
      }
      if (callee === 'useContext') {
        metadata.usesContext = true;
        if (!metadata.usesHooks.includes('useContext')) {
          metadata.usesHooks.push('useContext');
        }
      }
      if (callee && callee.startsWith('use') && !metadata.usesHooks.includes(callee)) {
        metadata.usesHooks.push(callee);
      }
    }
  });

  return metadata;
}

function resolveImportPath(fromFile, importPath) {
  // Determine the base directory for resolving the import.
  // If the import uses a relative path (starts with '.'), resolve relative to the importing file's directory.
  // Otherwise, attempt to resolve it as a project-alias (e.g., "shared/components") relative to the project root.

  const baseDir = importPath.startsWith('.') ? path.dirname(fromFile) : projectRoot;
  const fullPath = path.resolve(baseDir, importPath);
  const possibilities = [
    `${fullPath}.js`,
    `${fullPath}.jsx`,
    `${fullPath}.ts`,
    `${fullPath}.tsx`,
    path.join(fullPath, 'index.js'),
    path.join(fullPath, 'index.jsx'),
    path.join(fullPath, 'index.ts'),
    path.join(fullPath, 'index.tsx'),
  ];
  for (const p of possibilities) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const files = await glob(['**/*.{js,jsx,ts,tsx}'], { cwd: projectRoot, absolute: true });

  const graph = {
    nodes: [],
    edges: []
  };

  const fileMap = {};

  for (const file of files) {
    const metadata = parseFile(file);
    fileMap[metadata.id] = metadata;
    graph.nodes.push(metadata);

    if (metadata.stateVariables && metadata.stateVariables.length > 0) {
      for (const stateVar of metadata.stateVariables) {
        const stateNodeId = `${metadata.id}::state::${stateVar}`;
        graph.nodes.push({
          id: stateNodeId,
          label: stateVar,
          parent: metadata.id,
          nodeType: 'state',
        });
        graph.edges.push({
          source: metadata.id,
          target: stateNodeId,
          type: 'state',
        });
      }
    }
  }

  for (const node of graph.nodes) {
    if (Array.isArray(node.imports)) {
      for (const target of node.imports) {
        if (fileMap[target]) {
          graph.edges.push({
            source: node.id,
            target: target,
            type: 'imports'
          });
        }
      }
    }
  }

  fs.writeFileSync('fileDependencyGraph.json', JSON.stringify(graph, null, 2));
  console.log('Dependency graph saved as fileDependencyGraph.json');
  
  // Generate HTML visualization file
  generateVisualization(graph);
  console.log('Visualization generated as dependency-graph.html');
}

function generateVisualization(graph) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Code Dependency Graph</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    #container {
      width: 100%;
      height: 100vh;
      overflow: hidden;
    }
    .node {
      cursor: pointer;
    }
    .link {
      stroke: #999;
      stroke-opacity: 0.6;
      stroke-width: 1px;
    }
    .tooltip {
      position: absolute;
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px;
      border-radius: 4px;
      font-size: 14px;
      pointer-events: none;
      z-index: 1000;
    }
    .controls {
      position: fixed;
      top: 10px;
      left: 10px;
      background: white;
      padding: 10px;
      border-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    button {
      margin: 5px;
      padding: 5px 10px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="controls">
    <button id="zoom-in">Zoom In</button>
    <button id="zoom-out">Zoom Out</button>
    <button id="reset">Reset</button>
  </div>
  <div id="container"></div>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script>
    // Graph data
    const graphData = ${JSON.stringify(graph)};
    
    // Dimensions
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Create a tooltip div
    const tooltip = d3.select("body")
      .append("div")
      .attr("class", "tooltip")
      .style("opacity", 0);
    
    // Create SVG
    const svg = d3.select("#container")
      .append("svg")
      .attr("width", width)
      .attr("height", height);
    
    // Create a group for zoom behavior
    const g = svg.append("g");
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom);
    
    // Create simulation
    const simulation = d3.forceSimulation(graphData.nodes)
      .force("link", d3.forceLink(graphData.edges)
        .id(d => d.id)
        .distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force("y", d3.forceY(height / 2).strength(0.1));
    
    // Draw links
    const link = g.selectAll(".link")
      .data(graphData.edges)
      .enter()
      .append("line")
      .attr("class", "link");
    
    // Create a color scale based on file type
    const fileTypes = [...new Set(graphData.nodes.filter(d => d.nodeType === 'file').map(d => d.fileType))];
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(fileTypes);
    const stateColor = '#ff7f0e'; // Orange for state variables
    
    // Create node elements
    const node = g.selectAll(".node")
      .data(graphData.nodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", d => {
        return d.nodeType === 'state' ? 4 : (5 + d.linesOfCode / 100);
      })
      .attr("fill", d => {
        return d.nodeType === 'state' ? stateColor : colorScale(d.fileType);
      })
      .on("mouseover", function(event, d) {
        tooltip.transition()
          .duration(200)
          .style("opacity", 0.9);
          
        let tooltipContent = \`
          <strong>File:</strong> \${d.id}<br/>
          <strong>Lines:</strong> \${d.linesOfCode}<br/>
          <strong>Type:</strong> \${d.fileType}<br/>
        \`;
        
        if (d.nodeType === 'state') {
          tooltipContent = \`<strong>State Variable:</strong> \${d.label}\`;
        }
        
        if (d.nodeType !== 'state') {
          if (Array.isArray(d.components) && d.components.length > 0) {
            tooltipContent += \`<strong>Components:</strong> \${d.components.join(", ")}<br/>\`;
          }
          if (Array.isArray(d.usesHooks) && d.usesHooks.length > 0) {
            tooltipContent += \`<strong>Hooks:</strong> \${d.usesHooks.join(", ")}<br/>\`;
          }
          if (d.usesContext) {
            tooltipContent += \`<strong>Uses Context:</strong> Yes<br/>\`;
          }
          if (d.declaresRoutes) {
            tooltipContent += \`<strong>Declares Routes:</strong> Yes<br/>\`;
          }
        }
        
        tooltip.html(tooltipContent)
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 28) + "px");
      })
      .on("mouseout", function(d) {
        tooltip.transition()
          .duration(500)
          .style("opacity", 0);
      })
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));
    
    // Update positions during simulation
    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);
  
      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);
    });
    
    // Drag functions
    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    
    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    
    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
    
    // Button controls
    document.getElementById("zoom-in").addEventListener("click", () => {
      svg.transition().call(zoom.scaleBy, 1.5);
    });
    
    document.getElementById("zoom-out").addEventListener("click", () => {
      svg.transition().call(zoom.scaleBy, 0.75);
    });
    
    document.getElementById("reset").addEventListener("click", () => {
      svg.transition().call(zoom.transform, d3.zoomIdentity);
    });
  </script>
</body>
</html>
  `;
  
  fs.writeFileSync('dependency-graph.html', htmlContent);
}

main().catch(console.error);
