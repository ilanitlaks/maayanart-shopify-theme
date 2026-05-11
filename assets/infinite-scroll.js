document.addEventListener("DOMContentLoaded", () => {
  let loading = false;

  const button = document.createElement("button");

  button.className = "load-more-button button";
  button.innerText = "לראות עוד";

  async function loadMoreProducts() {
    if (loading) return;

    const nextLink = document.querySelector(".pagination__item--prev");

    if (!nextLink) {
      button.remove();
      return;
    }

    loading = true;

    button.innerText = "טוען...";

    try {
      const response = await fetch(nextLink.href);
      const text = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "text/html");

      const newProducts = doc.querySelectorAll("#product-grid .grid__item");
      const productGrid = document.querySelector("#product-grid");

      newProducts.forEach((product) => {
        productGrid.appendChild(product);
      });

      const newPagination = doc.querySelector(".infinite-scroll-pagination");
      const currentPagination = document.querySelector(
        ".infinite-scroll-pagination",
      );

      if (newPagination && currentPagination) {
        currentPagination.innerHTML = newPagination.innerHTML;
      } else if (currentPagination) {
        currentPagination.remove();
        button.remove();
      }
    } catch (error) {
      console.error("Load more error:", error);
    }

    loading = false;

    button.innerText = "לראות עוד";
  }

  button.addEventListener("click", loadMoreProducts);

  const collection = document.querySelector(".collection");

  if (collection && document.querySelector(".pagination__item--prev")) {
    collection.appendChild(button);
  }
});
