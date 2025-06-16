import json
import networkx as nx
import matplotlib.pyplot as plt
import os

def load_dependency_graph(json_path):
    if not os.path.exists(json_path):
        raise FileNotFoundError(f"{json_path} not found")

    with open(json_path, "r") as f:
        data = json.load(f)

    return data
def build_graph(data):
    G = nx.DiGraph()

    for node in data["nodes"]:
        G.add_node(
            node["id"],
            lines=node.get("linesOfCode", 0),
            components=len(node.get("components", [])),
            label=node["id"].split("/")[-1]
        )

    for edge in data["edges"]:
        G.add_edge(edge["source"], edge["target"], type=edge["type"])

    return G
def visualize_graph(G, title="File Dependency Graph"):
    plt.figure(figsize=(16, 12))
    pos = nx.spring_layout(G, k=0.35, iterations=100, seed=42)

    node_sizes = [max(G.nodes[n]["lines"], 1) * 2 + 100 for n in G.nodes]
    node_colors = [G.nodes[n]["components"] for n in G.nodes]

    nodes = nx.draw_networkx_nodes(
        G, pos, node_size=node_sizes,
        node_color=node_colors, cmap=plt.cm.viridis,
        alpha=0.85
    )

    edges = nx.draw_networkx_edges(
        G, pos, arrowstyle='->',
        arrowsize=12, edge_color="gray"
    )

    labels = {n: G.nodes[n]["label"] for n in G.nodes}
    nx.draw_networkx_labels(G, pos, labels, font_size=10, font_family="sans-serif")

    plt.title(title, fontsize=18)
    plt.colorbar(nodes, label="Number of Components")
    plt.axis("off")
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    json_file = "fileDependencyGraph.json"
    data = load_dependency_graph(json_file)
    graph = build_graph(data)
    visualize_graph(graph)